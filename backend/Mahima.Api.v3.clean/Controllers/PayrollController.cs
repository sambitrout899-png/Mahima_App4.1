using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Mahima.Api.v3.clean.Services;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Mahima.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PayrollController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly IWebHostEnvironment _env;
        private readonly ITenantPrintTemplateService _printTemplates;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        // Keep the payslip text ASCII-only so every PDF viewer renders it reliably.
        private const string RUPEE = "Rs.";

        public PayrollController(MahimaDbContext db, IWebHostEnvironment env, ITenantPrintTemplateService printTemplates)
        {
            _db = db;
            _env = env;
            _printTemplates = printTemplates;
        }

        // ---------- helpers ----------------------------------------------
        private string? GetActorIdString() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirst("sub")?.Value;

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        private bool IsAdmin()
        {
            if (User.IsInRole("Admin") || User.IsInRole("Administrator"))
                return true;

            var roleClaims = User.FindAll(ClaimTypes.Role)
                                 .Select(c => c.Value?.ToLowerInvariant())
                                 .Where(v => !string.IsNullOrWhiteSpace(v))
                                 .ToList();
            if (roleClaims.Contains("admin") || roleClaims.Contains("administrator"))
                return true;

            var simple = User.FindFirst("role")?.Value?.ToLowerInvariant();
            return simple == "admin" || simple == "administrator";
        }

        private void AddAudit(string action, string entityType, string entityId, object? details)
        {
            _db.AuditLogs.Add(new AuditLog
            {
                TenantId   = GetCurrentTenantId(),
                Action     = action,
                EntityType = entityType,
                EntityId   = entityId,
                Details    = details != null ? JsonSerializer.Serialize(details) : null,
                CreatedAt  = DateTime.UtcNow
            });
        }

        private IQueryable<Timesheet> FilterTimesheets(string userId, DateTime from, DateTime to)
        {
            var fromDate = from.Date;
            var toDate   = to.Date;
            return _db.Timesheets
                      .AsNoTracking()
                       .Where(x => x.TenantId == GetCurrentTenantId() &&
                                  x.UserId == userId &&
                                  x.Date >= fromDate &&
                                  x.Date <= toDate);
        }

        private async Task<StaffPayrollSetting?> GetPayrollSettingAsync(string userId)
        {
            return await _db.StaffPayrollSettings
                            .AsNoTracking()
                            .FirstOrDefaultAsync(x => x.TenantId == GetCurrentTenantId() && x.UserId == userId && x.IsActive);
        }

        // Pay is computed from days actually marked "Present" (or "P"), not logged
        // Timesheet hours -- matches V4.0's real payroll behavior exactly (see the
        // formula comment on the frontend PayrollPage.jsx). "HourlyRate" here is
        // really a per-day rate; the field name is kept for API/DB compatibility.
        private async Task<int> GetPresentDaysAsync(string userId, DateTime from, DateTime to)
        {
            var records = await _db.AttendanceRecords.AsNoTracking()
                .Where(a => a.TenantId == GetCurrentTenantId() && a.UserId == userId
                    && a.Date >= from.Date && a.Date <= to.Date)
                .Select(a => a.Status)
                .ToListAsync();

            return records.Count(status =>
            {
                var s = (status ?? string.Empty).Trim().ToLowerInvariant();
                return s == "present" || s == "p";
            });
        }

        // Nets out any advance already paid out as a PAYROLL-category Expense against
        // this staff member for this period, so it isn't paid twice (once as an
        // advance, once again inside the full payroll run) -- matches V4.0's
        // "Payroll advances from expenses" deduction.
        private async Task<decimal> GetPayrollAdvanceAsync(string userId, string? displayName, DateTime from, DateTime to)
        {
            var monthKey = from.ToString("yyyy-MM");
            var user = Guid.TryParse(userId, out var uid)
                ? await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid && u.TenantId == GetCurrentTenantId())
                : null;

            var matchKeys = new[] { displayName, user?.DisplayName, user?.Username, user?.Email, userId }
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Select(k => k!.Trim().ToLowerInvariant())
                .ToHashSet();

            var expenses = await _db.Expenses.AsNoTracking()
                .Where(e => e.TenantId == GetCurrentTenantId() && e.Category == "PAYROLL" && e.PayrollPerson != null)
                .Select(e => new { e.PayrollPerson, e.PayrollMonth, e.Amount })
                .ToListAsync();

            return expenses
                .Where(e =>
                {
                    var person = e.PayrollPerson!.Trim().ToLowerInvariant();
                    if (!matchKeys.Contains(person)) return false;
                    var month = (e.PayrollMonth ?? string.Empty).Trim();
                    return string.IsNullOrEmpty(month) || month == monthKey;
                })
                .Sum(e => e.Amount);
        }

        private async Task EnsurePayrollPaymentColumnsAsync()
        {
            await _db.Database.ExecuteSqlRawAsync(@"
                ALTER TABLE public.payroll_runs
                    ADD COLUMN IF NOT EXISTS previous_arrears numeric(18,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS payable_amount numeric(18,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS balance_amount numeric(18,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS payment_status varchar(32) NOT NULL DEFAULT 'UNPAID',
                    ADD COLUMN IF NOT EXISTS payment_notes text NULL,
                    ADD COLUMN IF NOT EXISTS paid_at_utc timestamp with time zone NULL;
            ");

            await _db.Database.ExecuteSqlRawAsync(@"
                UPDATE public.payroll_runs
                SET payable_amount = CASE WHEN payable_amount = 0 THEN net_amount + previous_arrears ELSE payable_amount END,
                    balance_amount = CASE
                        WHEN balance_amount = 0 AND paid_amount = 0 THEN GREATEST(0, net_amount + previous_arrears)
                        ELSE GREATEST(0, payable_amount - paid_amount)
                    END,
                    payment_status = CASE
                        WHEN COALESCE(paid_amount, 0) <= 0 THEN 'UNPAID'
                        WHEN GREATEST(0, COALESCE(payable_amount, net_amount) - COALESCE(paid_amount, 0)) <= 0 THEN 'PAID'
                        ELSE 'PARTIAL'
                    END
                WHERE payable_amount = 0 OR balance_amount = 0 OR payment_status IS NULL OR payment_status = '';
            ");
        }

        private async Task<decimal> GetPreviousArrearsAsync(string userId, DateTime from)
        {
            await EnsurePayrollPaymentColumnsAsync();
            var fromDate = DateTime.SpecifyKind(from.Date, DateTimeKind.Utc);

            // Arrears are calculated only as of the selected payroll period.
            // Future payroll runs must not affect a backdated month.
            var previousRun = await _db.PayrollRuns
                .AsNoTracking()
                .Where(r => r.UserId == userId && r.From < fromDate && r.To < fromDate)
                .OrderByDescending(r => r.To)
                .ThenByDescending(r => r.RunAt)
                .FirstOrDefaultAsync();

            if (previousRun == null) return 0m;

            var payable = previousRun.PayableAmount > 0m
                ? previousRun.PayableAmount
                : previousRun.NetAmount + previousRun.PreviousArrears;
            return previousRun.BalanceAmount > 0m
                ? previousRun.BalanceAmount
                : Math.Max(0m, payable - previousRun.PaidAmount);
        }

        private static string PaymentStatus(decimal paid, decimal balance, decimal payable)
        {
            if (payable <= 0m || balance <= 0m) return "PAID";
            if (paid <= 0m) return "UNPAID";
            return "PARTIAL";
        }

        // Resolve a friendly display name from the Users table (best-effort).
        // Users.Id is a Guid in this project, so we parse the string first.
        private async Task<string> ResolveDisplayNameAsync(string userId)
        {
            try
            {
                if (!Guid.TryParse(userId, out var userGuid))
                    return userId;

                var user = await _db.Users
                                    .AsNoTracking()
                                    .FirstOrDefaultAsync(u => u.Id == userGuid && u.TenantId == GetCurrentTenantId());
                if (user == null) return userId;

                // Common name fields — fall through whichever is populated.
                return
                    NotBlank(user.DisplayName) ??
                    NotBlank(user.Username) ??
                    NotBlank(user.Email) ??
                    userId;
            }
            catch
            {
                // If the Users table doesn't exist or schema differs, just
                // return the id so the slip still renders.
                return userId;
            }

            static string? NotBlank(string? s) =>
                string.IsNullOrWhiteSpace(s) ? null : s;
        }

        private async Task<(string DisplayName, string MahimaId)> ResolvePayrollIdentityAsync(string userId)
        {
            try
            {
                if (!Guid.TryParse(userId, out var userGuid))
                    return (userId, userId);

                var user = await _db.Users
                                    .AsNoTracking()
                                    .FirstOrDefaultAsync(u => u.Id == userGuid);
                if (user == null) return (userId, userId);

                var displayName =
                    NotBlank(user.DisplayName) ??
                    NotBlank(user.Username) ??
                    NotBlank(user.Email) ??
                    userId;

                return (displayName, NotBlank(user.UserCode) ?? userId);
            }
            catch
            {
                return (userId, userId);
            }

            static string? NotBlank(string? s) =>
                string.IsNullOrWhiteSpace(s) ? null : s;
        }

        /// <summary>
        /// CORRECT formula:
        ///   Gross = FixedAmount + (Hours × Rate) + Allowances
        ///   Net   = max(0, Gross - Deductions)
        /// </summary>
        private static PayrollSummaryDto BuildSummary(
            string userId,
            string? displayName,
            string? mahimaId,
            DateTime from,
            DateTime to,
            decimal totalHours,
            StaffPayrollSetting? setting,
            decimal previousArrears = 0m,
            decimal paidAmount = 0m,
            decimal leaveDays = 0m,
            decimal paidLeaveDays = 0m,
            decimal payLossDays = 0m,
            decimal payLossAmount = 0m,
            int workingDays = 0,
            int weeklyOffDay = 0,
            decimal payrollAdvance = 0m)
        {
            var hourlyRate  = setting?.HourlyRate ?? 0m;
            var fixedAmount = setting?.MonthlyFixedAmount ?? 0m;
            var allowances  = setting?.Allowances ?? 0m;
            // Matches V4.0's real formula: Deductions = Fines (settings) + Payroll
            // advances (expenses). Leave-loss is tracked below for visibility only --
            // V4.0 never deducted it, so it does not reduce Net here.
            var deductions  = Math.Max(0m, (setting?.Deductions ?? 0m) + payrollAdvance);

            var hoursAmount = totalHours * hourlyRate;
            var gross       = fixedAmount + hoursAmount + allowances;
            var net         = Math.Max(0m, gross - deductions);
            var payable     = Math.Max(0m, net + previousArrears);
            var paid        = Math.Max(0m, paidAmount);
            var balance     = Math.Max(0m, payable - paid);

            return new PayrollSummaryDto
            {
                UserId       = userId,
                DisplayName  = displayName,
                MahimaId     = mahimaId,
                From         = from.Date,
                To           = to.Date,
                TotalHours   = totalHours,
                HourlyRate   = hourlyRate,
                FixedAmount  = fixedAmount,
                HourlyAmount = hoursAmount,
                Allowances   = allowances,
                Deductions   = deductions,
                GrossAmount  = gross,
                NetAmount    = net,
                PreviousArrears = previousArrears,
                PayableAmount = payable,
                PaidAmount = paid,
                BalanceAmount = balance,
                PaymentStatus = PaymentStatus(paid, balance, payable)
                ,PayrollAdvance = payrollAdvance
                ,LeaveDays = leaveDays
                ,PaidLeaveDays = paidLeaveDays
                ,PayLossDays = payLossDays
                ,PayLossAmount = payLossAmount
                ,WorkingDays = workingDays
                ,WeeklyOffDay = weeklyOffDay
            };
        }

        private static PayrollRunDto ToRunDto(PayrollRun run, string? displayName = null) => new PayrollRunDto
        {
            Id           = run.Id,
            UserId       = run.UserId,
            DisplayName  = displayName,
            From         = run.From,
            To           = run.To,
            TotalHours   = run.TotalHours,
            HourlyRate   = run.HourlyRate,
            FixedAmount  = run.FixedAmount,
            HourlyAmount = run.TotalHours * run.HourlyRate,
            Allowances   = run.Allowances,
            Deductions   = run.Deductions,
            GrossAmount  = run.GrossAmount,
            NetAmount    = run.NetAmount,
            PreviousArrears = run.PreviousArrears,
            PayableAmount = run.PayableAmount > 0m ? run.PayableAmount : run.NetAmount + run.PreviousArrears,
            PaidAmount = run.PaidAmount,
            BalanceAmount = run.BalanceAmount,
            PaymentStatus = string.IsNullOrWhiteSpace(run.PaymentStatus) ? PaymentStatus(run.PaidAmount, run.BalanceAmount, run.PayableAmount) : run.PaymentStatus,
            PaymentNotes = run.PaymentNotes,
            PaidAtUtc = run.PaidAtUtc
        };

        private string GetLogoPath()
        {
            var root = _env.WebRootPath ?? string.Empty;
            return System.IO.Path.Combine(root, "images", "mahima-logo.png");
        }

        private static string PayrollFinanceMarker(Guid runId) => $"[PAYROLL_RUN:{runId}]";

        private async Task<Account> GetOrCreateAccountAsync(string name, string type)
        {
            var account = await _db.Accounts.FirstOrDefaultAsync(a => a.Name == name);
            if (account != null)
            {
                if (!string.Equals(account.Type, type, StringComparison.OrdinalIgnoreCase))
                    account.Type = type;
                return account;
            }

            account = new Account
            {
                Name = name,
                Type = type,
                CreatedAt = DateTime.UtcNow
            };
            _db.Accounts.Add(account);
            return account;
        }

        private async Task DeletePayrollRunFinanceAsync(Guid runId)
        {
            var marker = PayrollFinanceMarker(runId);

            var expenses = await _db.Expenses
                .Where(e => e.Notes != null && e.Notes.Contains(marker))
                .ToListAsync();
            if (expenses.Count > 0)
                _db.Expenses.RemoveRange(expenses);

            var journals = await _db.JournalEntries
                .Include(e => e.Lines)
                .Where(e => e.Description != null && e.Description.Contains(marker))
                .ToListAsync();
            foreach (var journal in journals)
            {
                _db.JournalLines.RemoveRange(journal.Lines);
                _db.JournalEntries.Remove(journal);
            }
        }

        private async Task SyncPayrollRunFinanceAsync(PayrollRun run, string? displayName = null)
        {
            await EnsurePayrollPaymentColumnsAsync();
            await DeletePayrollRunFinanceAsync(run.Id);

            var marker = PayrollFinanceMarker(run.Id);
            var staffName = string.IsNullOrWhiteSpace(displayName)
                ? (string.IsNullOrWhiteSpace(run.StaffName) ? run.UserId : run.StaffName)
                : displayName;
            var payrollMonth = run.From.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            var payable = run.PayableAmount > 0m ? run.PayableAmount : run.NetAmount + run.PreviousArrears;
            var paid = Math.Min(Math.Max(0m, run.PaidAmount), payable);
            var balance = Math.Max(0m, payable - paid);

            if (paid > 0m)
            {
                _db.Expenses.Add(new Expense
                {
                    Description = $"Payroll paid - {staffName} - {payrollMonth}",
                    Category = "PAYROLL",
                    Amount = paid,
                    Date = (run.PaidAtUtc ?? DateTime.UtcNow).Date,
                    Vendor = staffName,
                    PayrollPerson = staffName,
                    PayrollMonth = payrollMonth,
                    Notes = $"Auto generated from payroll run {run.Id} {marker}",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                });
            }

            if (payable > 0m)
            {
                var payrollExpense = await GetOrCreateAccountAsync("Payroll Expense", "EXPENSE");
                var bank = await GetOrCreateAccountAsync("Bank", "ASSET");
                var payrollPayable = await GetOrCreateAccountAsync("Payroll Payable", "LIABILITY");

                var entry = new JournalEntry
                {
                    Date = run.To.Date,
                    Description = $"Payroll run - {staffName} - {payrollMonth} {marker}",
                    CreatedAt = DateTime.UtcNow,
                    Lines = new List<JournalLine>
                    {
                        new()
                        {
                            AccountId = payrollExpense.Id,
                            Debit = payable,
                            Credit = 0
                        }
                    }
                };

                if (paid > 0m)
                {
                    entry.Lines.Add(new JournalLine
                    {
                        AccountId = bank.Id,
                        Debit = 0,
                        Credit = paid
                    });
                }

                if (balance > 0m)
                {
                    entry.Lines.Add(new JournalLine
                    {
                        AccountId = payrollPayable.Id,
                        Debit = 0,
                        Credit = balance
                    });
                }

                _db.JournalEntries.Add(entry);
            }
        }

        // ---------- SETTINGS ---------------------------------------------
        [HttpGet("settings")]
        public async Task<IActionResult> GetSettings()
        {
            if (!IsAdmin()) return Forbid();

            var list = await _db.StaffPayrollSettings
                                .Where(x => x.TenantId == GetCurrentTenantId())
                                .OrderBy(x => x.UserId)
                                .ToListAsync();
            return Ok(list);
        }

        [HttpPost("settings")]
        public async Task<IActionResult> UpsertSetting([FromBody] StaffPayrollSetting dto)
        {
            if (!IsAdmin()) return Forbid();

            if (string.IsNullOrWhiteSpace(dto.UserId))
                return BadRequest("UserId is required.");

            if (dto.HourlyRate < 0 || dto.MonthlyFixedAmount < 0 ||
                dto.Allowances < 0 || dto.Deductions < 0)
                return BadRequest("Amounts cannot be negative.");

            var existing = await _db.StaffPayrollSettings
                                    .FirstOrDefaultAsync(x => x.TenantId == GetCurrentTenantId() && x.UserId == dto.UserId);

            if (existing == null)
            {
                dto.Id = 0;
                dto.TenantId = GetCurrentTenantId();
                _db.StaffPayrollSettings.Add(dto);
                AddAudit("Payroll.Settings.Create", "StaffPayrollSetting", dto.UserId, dto);
            }
            else
            {
                existing.HourlyRate         = dto.HourlyRate;
                existing.MonthlyFixedAmount = dto.MonthlyFixedAmount;
                existing.Allowances         = dto.Allowances;
                existing.Deductions         = dto.Deductions;
                existing.IsActive           = dto.IsActive;
                AddAudit("Payroll.Settings.Update", "StaffPayrollSetting", dto.UserId, dto);
            }

            await _db.SaveChangesAsync();
            return Ok(dto);
        }

        // ---------- SUMMARY ----------------------------------------------
        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary(
            [FromQuery] string? userId,
            [FromQuery] DateTime from,
            [FromQuery] DateTime to)
        {
            if (!IsAdmin()) return Forbid();

            if (from == default || to == default || from > to)
                return BadRequest("Valid 'from' and 'to' dates are required.");
            if (string.IsNullOrWhiteSpace(userId))
                return BadRequest("userId is required.");

            var setting     = await GetPayrollSettingAsync(userId);
            var weeklyOffDay = setting?.WeeklyOffDay is >= 0 and <= 6 ? setting.WeeklyOffDay : 0;
            var attendance = await _db.AttendanceRecords.AsNoTracking()
                .Where(a => a.TenantId == GetCurrentTenantId() && a.UserId == userId && a.Date >= from.Date && a.Date <= to.Date)
                .ToListAsync();
            // Pay is driven by days actually marked Present/P -- matches V4.0's real
            // formula (see GetPresentDaysAsync). Timesheet hours are not used for pay.
            var totalHours = (decimal)attendance.Count(a =>
            {
                var s = (a.Status ?? string.Empty).Trim().ToLowerInvariant();
                return s == "present" || s == "p";
            });
            var monthlyLeave = attendance
                .Where(a =>
                {
                    var status = (a.Status ?? string.Empty).Trim().ToLowerInvariant();
                    return status == "leave" || status.StartsWith("leave (");
                })
                .GroupBy(a => new { a.Date.Year, a.Date.Month })
                .Select(group => new { group.Key.Year, group.Key.Month, Days = (decimal)group.Count() })
                .ToList();
            var leaveDays = monthlyLeave.Sum(month => month.Days);
            // The one paid day is evaluated independently in every calendar month;
            // an unused allowance cannot offset excess leave in another month.
            var paidLeaveDays = monthlyLeave.Sum(month => Math.Min(1m, month.Days));
            var payLossDays = monthlyLeave.Sum(month => Math.Max(0m, month.Days - 1m));
            var workingDays = 0;
            for (var date = from.Date; date <= to.Date; date = date.AddDays(1))
                if ((int)date.DayOfWeek != weeklyOffDay) workingDays++;
            var fixedAmount = setting?.MonthlyFixedAmount ?? 0m;
            var payLossAmount = monthlyLeave.Sum(month =>
            {
                var daysInMonth = DateTime.DaysInMonth(month.Year, month.Month);
                var monthWorkingDays = Enumerable.Range(1, daysInMonth)
                    .Count(day => (int)new DateTime(month.Year, month.Month, day).DayOfWeek != weeklyOffDay);
                var excess = Math.Max(0m, month.Days - 1m);
                return monthWorkingDays > 0 ? (fixedAmount / monthWorkingDays) * excess : 0m;
            });
            payLossAmount = Math.Round(payLossAmount, 2);
            var identity = await ResolvePayrollIdentityAsync(userId);
            var previousArrears = await GetPreviousArrearsAsync(userId, from);
            var payrollAdvance = await GetPayrollAdvanceAsync(userId, identity.DisplayName, from, to);
            var summary     = BuildSummary(userId, identity.DisplayName, identity.MahimaId, from, to, totalHours, setting, previousArrears,
                leaveDays: leaveDays, paidLeaveDays: paidLeaveDays, payLossDays: payLossDays,
                payLossAmount: payLossAmount, workingDays: workingDays, weeklyOffDay: weeklyOffDay,
                payrollAdvance: payrollAdvance);

            AddAudit("Payroll.Summary", "Payroll", userId, new { from, to, summary });
            await _db.SaveChangesAsync();
            return Ok(summary);
        }

        // ---------- RUNS -------------------------------------------------
        [HttpGet("~/api/payroll/runs")]
        public async Task<IActionResult> GetRuns([FromQuery] string? userId)
        {
            if (!IsAdmin()) return Forbid();

            var query = _db.PayrollRuns.Where(r => r.TenantId == GetCurrentTenantId());
            if (!string.IsNullOrWhiteSpace(userId))
                query = query.Where(r => r.UserId == userId);

            var runs = await query
                .OrderByDescending(r => r.From)
                .ThenByDescending(r => r.Id)
                .ToListAsync();

            // Resolve names in one query. Users.Id is a Guid, so we parse the
            // string ids first and discard any that don't parse.
            var idGuids = runs
                .Select(r => r.UserId)
                .Distinct()
                .Select(s => Guid.TryParse(s, out var g) ? (Guid?)g : null)
                .Where(g => g.HasValue)
                .Select(g => g!.Value)
                .ToList();

            Dictionary<string, string?> nameMap;
            try
            {
                nameMap = await _db.Users
                    .AsNoTracking()
                    .Where(u => u.TenantId == GetCurrentTenantId() && idGuids.Contains(u.Id))
                    .ToDictionaryAsync(
                        u => u.Id.ToString(),
                        u => (string?)(NotBlank(u.DisplayName) ?? NotBlank(u.Username) ?? NotBlank(u.Email))
                    );
            }
            catch
            {
                nameMap = new Dictionary<string, string?>();
            }

            var dtos = runs.Select(r =>
                ToRunDto(r, nameMap.TryGetValue(r.UserId, out var n) ? n : null)
            ).ToList();

            return Ok(dtos);

            static string? NotBlank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
        }

        [HttpPost("~/api/payroll/runs")]
        public async Task<IActionResult> CreateRun([FromBody] PayrollRunRequest dto)
        {
            if (!IsAdmin()) return Forbid();

            if (dto == null) return BadRequest("Body is required.");
            if (dto.From == default || dto.To == default || dto.From > dto.To)
                return BadRequest("Valid 'from' and 'to' dates are required.");
            if (string.IsNullOrWhiteSpace(dto.UserId))
                return BadRequest("userId is required.");

            // Reject silly numbers
            if (dto.TotalHours < 0 || dto.HourlyRate < 0 ||
                dto.GrossAmount < 0 || dto.NetAmount < 0 || dto.PaidAmount < 0)
                return BadRequest("Amounts cannot be negative.");

            var previousArrears = await GetPreviousArrearsAsync(dto.UserId, dto.From);
            var paid = dto.PaidAmount;
            var payable = dto.NetAmount + previousArrears;
            var balance = Math.Max(0m, payable - paid);

            var run = new PayrollRun
            {
                TenantId = GetCurrentTenantId(),
                UserId      = dto.UserId,
                StaffName   = dto.DisplayName,
                From        = DateTime.SpecifyKind(dto.From.Date, DateTimeKind.Utc),
                To          = DateTime.SpecifyKind(dto.To.Date,   DateTimeKind.Utc),
                TotalHours  = dto.TotalHours,
                HourlyRate  = dto.HourlyRate,
                FixedAmount = dto.FixedAmount,
                Allowances  = dto.Allowances,
                Deductions  = dto.Deductions,
                GrossAmount = dto.GrossAmount,
                NetAmount   = dto.NetAmount,
                PreviousArrears = previousArrears,
                PayableAmount = payable,
                PaidAmount = paid,
                BalanceAmount = balance,
                PaymentStatus = PaymentStatus(paid, balance, payable),
                PaymentNotes = dto.PaymentNotes,
                PaidAtUtc = paid > 0m ? DateTime.UtcNow : null
            };

            _db.PayrollRuns.Add(run);
            AddAudit("Payroll.Run.Create", "PayrollRun", dto.UserId, run);
            await _db.SaveChangesAsync();

            var displayName = await ResolveDisplayNameAsync(run.UserId);
            await SyncPayrollRunFinanceAsync(run, displayName);
            AddAudit("Payroll.Run.FinanceSync", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To, run.PayableAmount, run.PaidAmount, run.BalanceAmount });
            await _db.SaveChangesAsync();

            return Ok(ToRunDto(run, displayName));
        }

        [HttpPatch("~/api/payroll/runs/{id:guid}/payment")]
        public async Task<IActionResult> UpdatePayment(Guid id, [FromBody] PayrollPaymentRequest dto)
        {
            if (!IsAdmin()) return Forbid();

            if (dto == null) return BadRequest("Body is required.");
            if (dto.PaidAmount < 0) return BadRequest("Paid amount cannot be negative.");

            await EnsurePayrollPaymentColumnsAsync();
            var run = await _db.PayrollRuns.FindAsync(id);
            if (run == null) return NotFound();

            var payable = run.PayableAmount > 0m ? run.PayableAmount : run.NetAmount + run.PreviousArrears;
            var paid = Math.Min(dto.PaidAmount, payable);
            var balance = Math.Max(0m, payable - paid);

            run.PayableAmount = payable;
            run.PaidAmount = paid;
            run.BalanceAmount = balance;
            run.PaymentStatus = PaymentStatus(paid, balance, payable);
            run.PaymentNotes = dto.PaymentNotes;
            run.PaidAtUtc = paid > 0m ? DateTime.UtcNow : null;

            AddAudit("Payroll.Run.Payment", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To, run.PayableAmount, run.PaidAmount, run.BalanceAmount, run.PaymentStatus });
            var displayName = await ResolveDisplayNameAsync(run.UserId);
            await SyncPayrollRunFinanceAsync(run, displayName);
            AddAudit("Payroll.Run.FinanceSync", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To, run.PayableAmount, run.PaidAmount, run.BalanceAmount });
            await _db.SaveChangesAsync();

            return Ok(ToRunDto(run, displayName));
        }

        // Full edit of a saved historical run (period, days/rate/fixed/allowances/deductions/
        // arrears/paid amount) -- distinct from UpdatePayment, which only patches paid amount.
        [HttpPut("~/api/payroll/runs/{id:guid}")]
        public async Task<IActionResult> UpdateRun(Guid id, [FromBody] PayrollRunRequest dto)
        {
            if (!IsAdmin()) return Forbid();

            if (dto == null) return BadRequest("Body is required.");
            if (dto.From == default || dto.To == default || dto.From > dto.To)
                return BadRequest("Valid 'from' and 'to' dates are required.");
            if (dto.TotalHours < 0 || dto.HourlyRate < 0 || dto.FixedAmount < 0 ||
                dto.Allowances < 0 || dto.Deductions < 0 || dto.PreviousArrears < 0 || dto.PaidAmount < 0)
                return BadRequest("Amounts cannot be negative.");

            var tenantId = GetCurrentTenantId();
            var run = await _db.PayrollRuns.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId);
            if (run == null) return NotFound();

            var gross = dto.FixedAmount + (dto.TotalHours * dto.HourlyRate) + dto.Allowances;
            var net = Math.Max(0m, gross - dto.Deductions);
            var payable = Math.Max(0m, net + dto.PreviousArrears);
            var paid = Math.Min(dto.PaidAmount, payable);
            var balance = Math.Max(0m, payable - paid);

            run.StaffName = string.IsNullOrWhiteSpace(dto.DisplayName) ? run.StaffName : dto.DisplayName;
            run.From = DateTime.SpecifyKind(dto.From.Date, DateTimeKind.Utc);
            run.To = DateTime.SpecifyKind(dto.To.Date, DateTimeKind.Utc);
            run.TotalHours = dto.TotalHours;
            run.HourlyRate = dto.HourlyRate;
            run.FixedAmount = dto.FixedAmount;
            run.Allowances = dto.Allowances;
            run.Deductions = dto.Deductions;
            run.GrossAmount = gross;
            run.NetAmount = net;
            run.PreviousArrears = dto.PreviousArrears;
            run.PayableAmount = payable;
            run.PaidAmount = paid;
            run.BalanceAmount = balance;
            run.PaymentStatus = PaymentStatus(paid, balance, payable);
            run.PaymentNotes = dto.PaymentNotes;
            run.PaidAtUtc = paid > 0m ? (run.PaidAtUtc ?? DateTime.UtcNow) : null;

            AddAudit("Payroll.Run.Update", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To, run.GrossAmount, run.NetAmount, run.PayableAmount, run.PaidAmount, run.BalanceAmount });
            var updateDisplayName = await ResolveDisplayNameAsync(run.UserId);
            await SyncPayrollRunFinanceAsync(run, updateDisplayName);
            AddAudit("Payroll.Run.FinanceSync", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To, run.PayableAmount, run.PaidAmount, run.BalanceAmount });
            await _db.SaveChangesAsync();

            return Ok(ToRunDto(run, updateDisplayName));
        }

        [HttpDelete("~/api/payroll/runs/{id:guid}")]
        public async Task<IActionResult> DeleteRun(Guid id)
        {
            if (!IsAdmin()) return Forbid();

            var run = await _db.PayrollRuns.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == GetCurrentTenantId());
            if (run == null) return NotFound();

            await DeletePayrollRunFinanceAsync(run.Id);
            _db.PayrollRuns.Remove(run);
            AddAudit("Payroll.Run.Delete", "PayrollRun", run.Id.ToString(),
                new { run.UserId, run.From, run.To });
            await _db.SaveChangesAsync();
            return NoContent();
        }

        [HttpPost("~/api/payroll/sync-finance")]
        public async Task<IActionResult> SyncExistingPayrollFinance()
        {
            if (!IsAdmin()) return Forbid();

            await EnsurePayrollPaymentColumnsAsync();
            var runs = await _db.PayrollRuns
                .Where(r => r.TenantId == GetCurrentTenantId())
                .OrderBy(r => r.From)
                .ThenBy(r => r.Id)
                .ToListAsync();

            var synced = 0;
            foreach (var run in runs)
            {
                var displayName = await ResolveDisplayNameAsync(run.UserId);
                await SyncPayrollRunFinanceAsync(run, displayName);
                AddAudit("Payroll.Run.FinanceBackfill", "PayrollRun", run.Id.ToString(),
                    new { run.UserId, run.From, run.To, run.PayableAmount, run.PaidAmount, run.BalanceAmount });
                synced++;
            }

            await _db.SaveChangesAsync();
            return Ok(new { success = true, synced });
        }

        [HttpGet("~/api/payroll/runs/{id:guid}/slip")]
        public async Task<IActionResult> GetRunSlip(Guid id)
        {
            if (!IsAdmin()) return Forbid();

            var run = await _db.PayrollRuns.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == GetCurrentTenantId());
            if (run == null) return NotFound();

            var identity = await ResolvePayrollIdentityAsync(run.UserId);

            var summary = new PayrollSummaryDto
            {
                UserId       = run.UserId,
                DisplayName  = identity.DisplayName,
                MahimaId     = identity.MahimaId,
                From         = run.From,
                To           = run.To,
                TotalHours   = run.TotalHours,
                HourlyRate   = run.HourlyRate,
                FixedAmount  = run.FixedAmount,
                HourlyAmount = run.TotalHours * run.HourlyRate,
                Allowances   = run.Allowances,
                Deductions   = run.Deductions,
                GrossAmount  = run.GrossAmount,
                NetAmount    = run.NetAmount,
                PreviousArrears = run.PreviousArrears,
                PayableAmount = run.PayableAmount > 0m ? run.PayableAmount : run.NetAmount + run.PreviousArrears,
                PaidAmount = run.PaidAmount,
                BalanceAmount = run.BalanceAmount,
                PaymentStatus = string.IsNullOrWhiteSpace(run.PaymentStatus) ? PaymentStatus(run.PaidAmount, run.BalanceAmount, run.PayableAmount) : run.PaymentStatus,
                PaymentNotes = run.PaymentNotes,
                PaidAtUtc = run.PaidAtUtc
            };

            var template = await _printTemplates.GetAsync(GetCurrentTenantId(), HttpContext.RequestAborted);
            var logo = await _printTemplates.LoadLogoAsync(template, HttpContext.RequestAborted);
            var pdfBytes = GenerateSalarySlipPdf(summary, template, logo);
            var fileName = SafeFileName($"SalarySlip_{summary.DisplayName ?? summary.UserId}_{summary.From:yyyyMM}.pdf");

            AddAudit("Payroll.Run.Slip", "PayrollRun", run.Id.ToString(), summary);
            await _db.SaveChangesAsync();
            return File(pdfBytes, "application/pdf", fileName);
        }

        // ---------- LEGACY SLIP BY PERIOD --------------------------------
        [HttpGet("slip")]
        public async Task<IActionResult> GetSalarySlipPdf(
            [FromQuery] string? userId,
            [FromQuery] DateTime from,
            [FromQuery] DateTime to)
        {
            if (!IsAdmin()) return Forbid();

            if (from == default || to == default || from > to)
                return BadRequest("Valid 'from' and 'to' dates are required.");
            if (string.IsNullOrWhiteSpace(userId))
                return BadRequest("userId is required.");

            var totalHours  = (decimal)await GetPresentDaysAsync(userId, from, to);
            var setting     = await GetPayrollSettingAsync(userId);
            var identity = await ResolvePayrollIdentityAsync(userId);

            var previousArrears = await GetPreviousArrearsAsync(userId, from);
            var payrollAdvance = await GetPayrollAdvanceAsync(userId, identity.DisplayName, from, to);
            var summary  = BuildSummary(userId, identity.DisplayName, identity.MahimaId, from, to, totalHours, setting, previousArrears,
                payrollAdvance: payrollAdvance);
            var template = await _printTemplates.GetAsync(GetCurrentTenantId(), HttpContext.RequestAborted);
            var logo = await _printTemplates.LoadLogoAsync(template, HttpContext.RequestAborted);
            var pdfBytes = GenerateSalarySlipPdf(summary, template, logo);
            var fileName = SafeFileName($"SalarySlip_{summary.DisplayName ?? summary.UserId}_{summary.From:yyyyMM}.pdf");

            AddAudit("Payroll.Slip.Generate", "Payroll", userId, new { from, to, summary });
            await _db.SaveChangesAsync();
            return File(pdfBytes, "application/pdf", fileName);
        }

        private static string SafeFileName(string name)
        {
            foreach (var c in System.IO.Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return name;
        }

        // ---------- PDF GENERATOR ----------------------------------------
        private static byte[] GenerateSalarySlipPdf(PayrollSummaryDto s, TenantPrintTemplate template, byte[]? logo)
        {
            var inr = CultureInfo.GetCultureInfo("en-IN");
            string Money(decimal v) => $"{RUPEE} {v.ToString("N2", inr)}";
            QuestPDF.Settings.License = LicenseType.Community;
            return Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(32);
                    page.Header().Column(col =>
                    {
                        if (logo is { Length: > 0 })
                            col.Item().AlignCenter().MaxWidth(100).MaxHeight(55).Image(logo).FitArea();
                        col.Item().AlignCenter().Text(template.OrganizationName).FontSize(19).Bold().FontColor(template.PrimaryColor);
                        if (!string.IsNullOrWhiteSpace(template.HeaderText))
                            col.Item().AlignCenter().Text(template.HeaderText).FontSize(9);
                        if (template.ShowAddress && !string.IsNullOrWhiteSpace(template.Address))
                            col.Item().AlignCenter().Text(template.Address).FontSize(8);
                        col.Item().PaddingTop(8).AlignCenter().Text("Salary Slip").FontSize(15).Bold();
                        col.Item().AlignCenter().Text($"Period: {s.From:dd MMM yyyy} to {s.To:dd MMM yyyy}").FontSize(9);
                    });
                    page.Content().PaddingTop(20).Column(col =>
                    {
                        col.Spacing(7);
                        col.Item().Text("Employee").Bold().FontColor(template.PrimaryColor);
                        col.Item().Text($"Name: {s.DisplayName ?? s.UserId}");
                        col.Item().Text($"Mahima ID: {s.MahimaId ?? s.UserId}");
                        col.Item().PaddingTop(8).Text("Earnings").Bold().FontColor(template.PrimaryColor);
                        AddMoneyRow(col, "Fixed monthly", Money(s.FixedAmount));
                        AddMoneyRow(col, $"Daily compensation ({s.TotalHours:N0} days)", Money(s.HourlyAmount));
                        AddMoneyRow(col, "Allowances", Money(s.Allowances));
                        AddMoneyRow(col, "Gross", Money(s.GrossAmount), true);
                        col.Item().PaddingTop(8).Text("Deductions").Bold().FontColor(template.PrimaryColor);
                        AddMoneyRow(col, "Fines + advances", Money(s.Deductions));
                        col.Item().PaddingTop(10).Background(template.PrimaryColor).Padding(9).Row(row =>
                        {
                            row.RelativeItem().Text("NET PAY").Bold().FontColor(Colors.White);
                            row.ConstantItem(160).AlignRight().Text(Money(s.NetAmount)).Bold().FontColor(Colors.White);
                        });
                        col.Item().PaddingTop(10).Text("Payment").Bold().FontColor(template.PrimaryColor);
                        AddMoneyRow(col, "Previous arrears", Money(s.PreviousArrears));
                        AddMoneyRow(col, "Payable this run", Money(s.PayableAmount));
                        AddMoneyRow(col, "Paid amount", Money(s.PaidAmount));
                        AddMoneyRow(col, $"Balance carried ({s.PaymentStatus})", Money(s.BalanceAmount));
                        col.Item().Text($"In words: {NumberToWordsIndian((long)Math.Round(s.PayableAmount, 0))} rupees only").Italic().FontSize(9);
                    });
                    page.Footer().Row(row =>
                    {
                        row.RelativeItem().Text(template.FooterText ?? "This is a system-generated payslip.").FontSize(8);
                        if (template.ShowPageNumbers)
                            row.ConstantItem(80).AlignRight().Text(t => { t.CurrentPageNumber(); t.Span(" / "); t.TotalPages(); });
                    });
                });
            }).GeneratePdf();
        }

        private static void AddMoneyRow(ColumnDescriptor col, string label, string value, bool bold = false)
        {
            col.Item().Row(row =>
            {
                var left = row.RelativeItem().Text(label);
                var right = row.ConstantItem(160).AlignRight().Text(value);
                if (bold) { left.Bold(); right.Bold(); }
            });
        }

        private static byte[] GeneratePlainTextPdf(IReadOnlyList<string> lines)
        {
            static string EscapePdf(string value) =>
                (value ?? string.Empty)
                    .Replace("\\", "\\\\")
                    .Replace("(", "\\(")
                    .Replace(")", "\\)");

            var content = new StringBuilder();
            content.AppendLine("BT");
            content.AppendLine("/F1 11 Tf");
            content.AppendLine("50 790 Td");
            content.AppendLine("14 TL");

            foreach (var line in lines)
            {
                content.Append('(').Append(EscapePdf(line)).AppendLine(") Tj");
                content.AppendLine("T*");
            }

            content.AppendLine("ET");
            var contentString = content.ToString();
            var contentBytes = Encoding.ASCII.GetBytes(contentString);

            var objects = new List<string>
            {
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                $"<< /Length {contentBytes.Length} >>\nstream\n{contentString}endstream"
            };

            var pdf = new StringBuilder();
            var offsets = new List<int> { 0 };
            pdf.AppendLine("%PDF-1.4");
            pdf.AppendLine("% Mahima payroll slip");

            for (var i = 0; i < objects.Count; i++)
            {
                offsets.Add(Encoding.ASCII.GetByteCount(pdf.ToString()));
                pdf.Append(i + 1).AppendLine(" 0 obj");
                pdf.AppendLine(objects[i]);
                pdf.AppendLine("endobj");
            }

            var xrefOffset = Encoding.ASCII.GetByteCount(pdf.ToString());
            pdf.AppendLine("xref");
            pdf.Append("0 ").AppendLine((objects.Count + 1).ToString(CultureInfo.InvariantCulture));
            pdf.AppendLine("0000000000 65535 f ");
            for (var i = 1; i < offsets.Count; i++)
                pdf.AppendLine($"{offsets[i]:0000000000} 00000 n ");
            pdf.AppendLine("trailer");
            pdf.AppendLine($"<< /Size {objects.Count + 1} /Root 1 0 R >>");
            pdf.AppendLine("startxref");
            pdf.AppendLine(xrefOffset.ToString(CultureInfo.InvariantCulture));
            pdf.AppendLine("%%EOF");

            return Encoding.ASCII.GetBytes(pdf.ToString());
        }

        // -----------------------------------------------------------------
        //  Indian numbering "amount in words" — handles up to crores.
        //  Returns capitalized phrase, e.g. "Twelve thousand three hundred".
        // -----------------------------------------------------------------
        private static string NumberToWordsIndian(long n)
        {
            if (n == 0) return "Zero";
            if (n < 0) return "Minus " + NumberToWordsIndian(-n);

            string[] ones =
            {
                "", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
                "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
                "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
            };
            string[] tens =
            {
                "", "", "Twenty", "Thirty", "Forty", "Fifty",
                "Sixty", "Seventy", "Eighty", "Ninety"
            };

            string TwoDigits(long x) =>
                x < 20 ? ones[x] : tens[x / 10] + (x % 10 != 0 ? " " + ones[x % 10] : "");

            string ThreeDigits(long x)
            {
                var sb = new StringBuilder();
                if (x >= 100)
                {
                    sb.Append(ones[x / 100]).Append(" Hundred");
                    x %= 100;
                    if (x != 0) sb.Append(' ');
                }
                if (x > 0) sb.Append(TwoDigits(x));
                return sb.ToString();
            }

            var parts = new StringBuilder();
            long crore = n / 10000000; n %= 10000000;
            long lakh  = n / 100000;   n %= 100000;
            long thou  = n / 1000;     n %= 1000;
            long rest  = n;

            if (crore > 0) parts.Append(ThreeDigits(crore)).Append(" Crore ");
            if (lakh  > 0) parts.Append(TwoDigits(lakh)).Append(" Lakh ");
            if (thou  > 0) parts.Append(TwoDigits(thou)).Append(" Thousand ");
            if (rest  > 0) parts.Append(ThreeDigits(rest));

            return parts.ToString().Trim();
        }
    }

    // ---------- DTOs -----------------------------------------------------
    public class PayrollSummaryDto
    {
        public string UserId { get; set; } = default!;
        public string? DisplayName { get; set; }
        public string? MahimaId { get; set; }
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public decimal TotalHours { get; set; }
        public decimal HourlyRate { get; set; }
        public decimal FixedAmount { get; set; }
        public decimal HourlyAmount { get; set; }
        public decimal Allowances { get; set; }
        public decimal Deductions { get; set; }
        public decimal GrossAmount { get; set; }
        public decimal NetAmount { get; set; }
        public decimal PreviousArrears { get; set; }
        public decimal PayableAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public string PaymentStatus { get; set; } = "UNPAID";
        public string? PaymentNotes { get; set; }
        public DateTime? PaidAtUtc { get; set; }
        public decimal PayrollAdvance { get; set; }
        public decimal LeaveDays { get; set; }
        public decimal PaidLeaveDays { get; set; }
        public decimal PayLossDays { get; set; }
        public decimal PayLossAmount { get; set; }
        public int WorkingDays { get; set; }
        public int WeeklyOffDay { get; set; }
    }

    public class PayrollRunRequest
    {
        public string UserId { get; set; } = default!;
        public string? DisplayName { get; set; }
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public decimal TotalHours { get; set; }
        public decimal HourlyRate { get; set; }
        public decimal FixedAmount { get; set; }
        public decimal HourlyAmount { get; set; }
        public decimal Allowances { get; set; }
        public decimal Deductions { get; set; }
        public decimal GrossAmount { get; set; }
        public decimal NetAmount { get; set; }
        public decimal PreviousArrears { get; set; }
        public decimal PayableAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public string PaymentStatus { get; set; } = "UNPAID";
        public string? PaymentNotes { get; set; }
        public DateTime? PaidAtUtc { get; set; }
    }

    public class PayrollPaymentRequest
    {
        public decimal PaidAmount { get; set; }
        public string? PaymentNotes { get; set; }
    }

    public class PayrollRunDto : PayrollRunRequest
    {
        public Guid Id { get; set; }
    }
}
