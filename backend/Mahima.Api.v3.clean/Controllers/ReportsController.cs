using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/reports")]
    public class ReportsController : ControllerBase
    {
        private const string ReportsPageKey = "REPORTS";
        private static readonly Regex SafeIdentifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;

        public ReportsController(MahimaDbContext db, ITenantContextService tenantContext)
        {
            _db = db;
            _tenantContext = tenantContext;
        }

        [HttpGet("cubes")]
        public async Task<IActionResult> GetCubes()
        {
            var denied = await EnsureReportsAccessAsync();
            if (denied != null) return denied;

            var tables = await LoadMetadataAsync();
            return Ok(tables.Select(table => new
            {
                key = table.Key,
                schema = table.Schema,
                table = table.Name,
                name = Humanize(table.Name),
                description = $"{table.Schema}.{table.Name}",
                approximateRows = table.ApproximateRows,
                fields = table.Columns.Select(column => new
                {
                    key = column.Name,
                    label = Humanize(column.Name),
                    type = column.Kind,
                    dbType = column.DbType,
                    nullable = column.Nullable,
                    ordinal = column.Ordinal
                })
            }));
        }

        [HttpPost("run")]
        public async Task<IActionResult> Run([FromBody] ReportRunRequest request)
        {
            var denied = await EnsureReportsAccessAsync();
            if (denied != null) return denied;

            request ??= new ReportRunRequest();
            request.Take = Math.Clamp(request.Take <= 0 ? 500 : request.Take, 1, 20000);
            request.Skip = Math.Max(0, request.Skip);
            request.Aggregation = string.IsNullOrWhiteSpace(request.Aggregation) ? "count" : request.Aggregation.Trim();

            var tables = await LoadMetadataAsync();
            var table = ResolveTable(tables, request.Cube);
            if (table == null)
                return BadRequest("Unknown report table.");
            if (table.Columns.Count == 0)
                return BadRequest("The selected table has no reportable columns.");

            var columns = ResolveColumns(table, request.Columns);
            var groupColumns = ResolveColumns(table, request.GroupBy, allowEmpty: true);
            var measure = ResolveColumn(table, request.Measure);
            var sortColumn = ResolveColumn(table, request.SortBy);

            var connection = _db.Database.GetDbConnection();
            var closeWhenDone = connection.State != ConnectionState.Open;
            if (closeWhenDone)
                await connection.OpenAsync(HttpContext.RequestAborted);

            try
            {
                var totalRows = await CountRowsAsync(connection, table, request);
                var rows = groupColumns.Count > 0
                    ? await RunGroupedAsync(connection, table, groupColumns, measure, request, totalRows)
                    : await RunDetailAsync(connection, table, columns, sortColumn, request, totalRows);

                return Ok(rows);
            }
            finally
            {
                if (closeWhenDone)
                    await connection.CloseAsync();
            }
        }

        private async Task<ReportRunResult> RunDetailAsync(
            DbConnection connection,
            TableMetadata table,
            IReadOnlyList<ColumnMetadata> columns,
            ColumnMetadata? sortColumn,
            ReportRunRequest request,
            int totalRows)
        {
            using var command = connection.CreateCommand();
            var where = BuildWhere(command, table, request);
            var selectList = string.Join(", ", columns.Select(c => $"{ColumnExpression(c)} AS {Quote(c.Name)}"));
            var orderBy = BuildDetailOrder(sortColumn, request.SortDir);

            command.CommandText = $@"
SELECT {selectList}
FROM {Quote(table.Schema)}.{Quote(table.Name)}
{where}
{orderBy}
LIMIT @take OFFSET @skip;";
            AddParameter(command, "@take", request.Take);
            AddParameter(command, "@skip", request.Skip);

            var rows = await ReadRowsAsync(command);
            return new ReportRunResult
            {
                Cube = table.Key,
                GeneratedAtUtc = DateTime.UtcNow,
                Mode = "detail",
                TotalRows = totalRows,
                ReturnedRows = rows.Count,
                Columns = columns.Select(c => c.Name).ToList(),
                Rows = rows,
                Metadata = BuildResultMetadata(table)
            };
        }

        private async Task<ReportRunResult> RunGroupedAsync(
            DbConnection connection,
            TableMetadata table,
            IReadOnlyList<ColumnMetadata> groupColumns,
            ColumnMetadata? measure,
            ReportRunRequest request,
            int totalRows)
        {
            using var command = connection.CreateCommand();
            var where = BuildWhere(command, table, request);
            var groups = string.Join(", ", groupColumns.Select(c => $"{ColumnExpression(c)} AS {Quote(c.Name)}"));
            var groupBy = string.Join(", ", groupColumns.Select(ColumnExpression));
            var aggregate = BuildAggregate(request.Aggregation, measure);
            var orderBy = NormalizeSortDir(request.SortDir) == "ASC" ? "ORDER BY value ASC" : "ORDER BY value DESC";

            command.CommandText = $@"
SELECT {groups}, {aggregate} AS value, COUNT(*)::bigint AS rows
FROM {Quote(table.Schema)}.{Quote(table.Name)}
{where}
GROUP BY {groupBy}
{orderBy}
LIMIT @take OFFSET @skip;";
            AddParameter(command, "@take", request.Take);
            AddParameter(command, "@skip", request.Skip);

            var rows = await ReadRowsAsync(command);
            var columns = groupColumns.Select(c => c.Name).Concat(new[] { "value", "rows" }).ToList();
            return new ReportRunResult
            {
                Cube = table.Key,
                GeneratedAtUtc = DateTime.UtcNow,
                Mode = "summary",
                TotalRows = totalRows,
                ReturnedRows = rows.Count,
                Columns = columns,
                Rows = rows,
                Metadata = BuildResultMetadata(table)
            };
        }

        private async Task<int> CountRowsAsync(DbConnection connection, TableMetadata table, ReportRunRequest request)
        {
            using var command = connection.CreateCommand();
            var where = BuildWhere(command, table, request);
            command.CommandText = $@"
SELECT COUNT(*)::int
FROM {Quote(table.Schema)}.{Quote(table.Name)}
{where};";
            var result = await command.ExecuteScalarAsync(HttpContext.RequestAborted);
            return Convert.ToInt32(result, CultureInfo.InvariantCulture);
        }

        private string BuildWhere(DbCommand command, TableMetadata table, ReportRunRequest request)
        {
            var clauses = new List<string>();
            var parameterIndex = 0;

            var dateField = ResolveColumn(table, request.DateField);
            if (dateField != null && request.From.HasValue)
            {
                var parameterName = $"@p{parameterIndex++}";
                clauses.Add($"{Quote(dateField.Name)} >= {parameterName}");
                AddParameter(command, parameterName, UnspecifiedDate(request.From.Value.Date));
            }

            if (dateField != null && request.To.HasValue)
            {
                var parameterName = $"@p{parameterIndex++}";
                clauses.Add($"{Quote(dateField.Name)} < {parameterName}");
                AddParameter(command, parameterName, UnspecifiedDate(request.To.Value.Date.AddDays(1)));
            }

            foreach (var filter in request.Filters ?? Enumerable.Empty<ReportFilterDto>())
            {
                var column = ResolveColumn(table, filter.Field);
                if (column == null) continue;

                var op = (filter.Op ?? "contains").Trim().ToLowerInvariant();
                if (op is "isempty" or "is-empty")
                {
                    clauses.Add($"({Quote(column.Name)} IS NULL OR CAST({Quote(column.Name)} AS TEXT) = '')");
                    continue;
                }

                if (op is "isnotempty" or "is-not-empty")
                {
                    clauses.Add($"({Quote(column.Name)} IS NOT NULL AND CAST({Quote(column.Name)} AS TEXT) <> '')");
                    continue;
                }

                if (string.IsNullOrWhiteSpace(filter.Value)) continue;

                if (op is "contains")
                {
                    var parameterName = $"@p{parameterIndex++}";
                    clauses.Add($"CAST({Quote(column.Name)} AS TEXT) ILIKE {parameterName}");
                    AddParameter(command, parameterName, $"%{filter.Value.Trim()}%");
                    continue;
                }

                if (op is "startswith" or "starts-with")
                {
                    var parameterName = $"@p{parameterIndex++}";
                    clauses.Add($"CAST({Quote(column.Name)} AS TEXT) ILIKE {parameterName}");
                    AddParameter(command, parameterName, $"{filter.Value.Trim()}%");
                    continue;
                }

                if (op is "endswith" or "ends-with")
                {
                    var parameterName = $"@p{parameterIndex++}";
                    clauses.Add($"CAST({Quote(column.Name)} AS TEXT) ILIKE {parameterName}");
                    AddParameter(command, parameterName, $"%{filter.Value.Trim()}");
                    continue;
                }

                if (op is "in")
                {
                    var values = filter.Value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Take(100)
                        .ToList();
                    if (values.Count == 0) continue;

                    var inParams = new List<string>();
                    foreach (var value in values)
                    {
                        var parameterName = $"@p{parameterIndex++}";
                        inParams.Add(parameterName);
                        AddTypedParameter(command, parameterName, column, value);
                    }
                    clauses.Add($"{FilterExpression(column)} IN ({string.Join(", ", inParams)})");
                    continue;
                }

                var symbol = op switch
                {
                    "equals" or "=" => "=",
                    "notequals" or "not-equals" or "!=" => "<>",
                    "gt" or ">" => ">",
                    "gte" or ">=" => ">=",
                    "lt" or "<" => "<",
                    "lte" or "<=" => "<=",
                    _ => "="
                };

                var typedParameterName = $"@p{parameterIndex++}";
                clauses.Add($"{FilterExpression(column)} {symbol} {typedParameterName}");
                AddTypedParameter(command, typedParameterName, column, filter.Value);
            }

            return clauses.Count == 0 ? string.Empty : "WHERE " + string.Join(" AND ", clauses);
        }

        private static string BuildAggregate(string aggregation, ColumnMetadata? measure)
        {
            var normalized = aggregation.Trim().ToLowerInvariant();
            if (normalized == "count" || measure == null)
                return "COUNT(*)::numeric";

            var column = ColumnExpression(measure);
            return normalized switch
            {
                "sum" => $"COALESCE(SUM({column}), 0)",
                "avg" or "average" => $"COALESCE(AVG({column}), 0)",
                "min" => $"COALESCE(MIN({column}), 0)",
                "max" => $"COALESCE(MAX({column}), 0)",
                _ => "COUNT(*)::numeric"
            };
        }

        private static string BuildDetailOrder(ColumnMetadata? sortColumn, string? sortDir)
        {
            if (sortColumn == null) return string.Empty;
            return $"ORDER BY {ColumnExpression(sortColumn)} {NormalizeSortDir(sortDir)} NULLS LAST";
        }

        private static string NormalizeSortDir(string? sortDir) =>
            string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";

        private async Task<List<TableMetadata>> LoadMetadataAsync()
        {
            var connection = _db.Database.GetDbConnection();
            var closeWhenDone = connection.State != ConnectionState.Open;
            if (closeWhenDone)
                await connection.OpenAsync(HttpContext.RequestAborted);

            try
            {
                var tables = new Dictionary<string, TableMetadata>(StringComparer.OrdinalIgnoreCase);

                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
SELECT t.table_schema,
       t.table_name,
       COALESCE(c.reltuples::bigint, 0) AS approximate_rows
FROM information_schema.tables t
LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;";

                    await using var reader = await command.ExecuteReaderAsync(HttpContext.RequestAborted);
                    while (await reader.ReadAsync(HttpContext.RequestAborted))
                    {
                        var schema = reader.GetString(0);
                        var name = reader.GetString(1);
                        if (!IsSafeIdentifier(schema) || !IsSafeIdentifier(name)) continue;

                        tables[name] = new TableMetadata
                        {
                            Key = name,
                            Schema = schema,
                            Name = name,
                            ApproximateRows = reader.IsDBNull(2) ? 0 : reader.GetInt64(2)
                        };
                    }
                }

                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
SELECT c.table_schema,
       c.table_name,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.ordinal_position
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema
 AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position;";

                    await using var reader = await command.ExecuteReaderAsync(HttpContext.RequestAborted);
                    while (await reader.ReadAsync(HttpContext.RequestAborted))
                    {
                        var tableName = reader.GetString(1);
                        var columnName = reader.GetString(2);
                        if (!tables.TryGetValue(tableName, out var table)) continue;
                        if (!IsSafeIdentifier(columnName) || IsSensitiveColumn(columnName)) continue;

                        var dataType = reader.GetString(3);
                        var udtName = reader.GetString(4);
                        table.Columns.Add(new ColumnMetadata
                        {
                            Name = columnName,
                            DbType = dataType,
                            UdtName = udtName,
                            Kind = MapColumnKind(dataType, udtName),
                            Nullable = string.Equals(reader.GetString(5), "YES", StringComparison.OrdinalIgnoreCase),
                            Ordinal = reader.GetInt32(6)
                        });
                    }
                }

                return tables.Values
                    .Where(t => t.Columns.Count > 0)
                    .OrderBy(t => Humanize(t.Name), StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }
            finally
            {
                if (closeWhenDone)
                    await connection.CloseAsync();
            }
        }

        private static TableMetadata? ResolveTable(IEnumerable<TableMetadata> tables, string? cube)
        {
            var requested = string.IsNullOrWhiteSpace(cube) ? "users" : cube.Trim();
            return tables.FirstOrDefault(t =>
                string.Equals(t.Key, requested, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(t.Name, requested, StringComparison.OrdinalIgnoreCase) ||
                string.Equals($"{t.Schema}.{t.Name}", requested, StringComparison.OrdinalIgnoreCase));
        }

        private static List<ColumnMetadata> ResolveColumns(TableMetadata table, IEnumerable<string>? names, bool allowEmpty = false)
        {
            var requested = (names ?? Enumerable.Empty<string>())
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(name => ResolveColumn(table, name))
                .Where(column => column != null)
                .Cast<ColumnMetadata>()
                .ToList();

            if (requested.Count > 0 || allowEmpty)
                return requested;

            return table.Columns.Take(80).ToList();
        }

        private static ColumnMetadata? ResolveColumn(TableMetadata table, string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            return table.Columns.FirstOrDefault(c => string.Equals(c.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        private static async Task<List<Dictionary<string, object?>>> ReadRowsAsync(DbCommand command)
        {
            var rows = new List<Dictionary<string, object?>>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < reader.FieldCount; i++)
                    row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                rows.Add(row);
            }
            return rows;
        }

        private static List<object> BuildResultMetadata(TableMetadata table) =>
            table.Columns.Select(column => new
            {
                key = column.Name,
                label = Humanize(column.Name),
                type = column.Kind,
                dbType = column.DbType,
                nullable = column.Nullable
            }).Cast<object>().ToList();

        private static void AddTypedParameter(DbCommand command, string name, ColumnMetadata column, string? rawValue)
        {
            var value = rawValue?.Trim() ?? string.Empty;
            object typedValue = value;

            if (column.Kind == "number" && decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var numeric))
                typedValue = numeric;
            else if (column.Kind == "boolean" && bool.TryParse(value, out var boolean))
                typedValue = boolean;
            else if (column.Kind == "date" && DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date))
                typedValue = UnspecifiedDate(date);
            else if (column.Kind == "uuid" && Guid.TryParse(value, out var guid))
                typedValue = guid;

            AddParameter(command, name, typedValue);
        }

        private static void AddParameter(DbCommand command, string name, object? value)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        private static DateTime UnspecifiedDate(DateTime value) =>
            DateTime.SpecifyKind(value, DateTimeKind.Unspecified);

        private static string Quote(string identifier)
        {
            if (!IsSafeIdentifier(identifier))
                throw new InvalidOperationException("Unsafe identifier.");
            return "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
        }

        private static string ColumnExpression(ColumnMetadata column) =>
            column.Kind == "json" ? $"CAST({Quote(column.Name)} AS TEXT)" : Quote(column.Name);

        private static string FilterExpression(ColumnMetadata column) =>
            column.Kind == "json" ? $"CAST({Quote(column.Name)} AS TEXT)" : Quote(column.Name);

        private static bool IsSafeIdentifier(string value) =>
            !string.IsNullOrWhiteSpace(value) && SafeIdentifier.IsMatch(value);

        private static bool IsSensitiveColumn(string name)
        {
            var value = name.ToLowerInvariant();
            return value.Contains("password", StringComparison.Ordinal) ||
                   value.Contains("token", StringComparison.Ordinal) ||
                   value.Contains("secret", StringComparison.Ordinal) ||
                   value.Contains("credential", StringComparison.Ordinal) ||
                   value.Contains("apikey", StringComparison.Ordinal) ||
                   value.Contains("api_key", StringComparison.Ordinal) ||
                   value.Contains("hash", StringComparison.Ordinal) ||
                   value.Contains("salt", StringComparison.Ordinal);
        }

        private static string MapColumnKind(string dataType, string udtName)
        {
            var type = $"{dataType} {udtName}".ToLowerInvariant();
            if (type.Contains("int", StringComparison.Ordinal) ||
                type.Contains("numeric", StringComparison.Ordinal) ||
                type.Contains("decimal", StringComparison.Ordinal) ||
                type.Contains("double", StringComparison.Ordinal) ||
                type.Contains("real", StringComparison.Ordinal) ||
                type.Contains("money", StringComparison.Ordinal))
                return "number";
            if (type.Contains("date", StringComparison.Ordinal) || type.Contains("time", StringComparison.Ordinal))
                return "date";
            if (type.Contains("bool", StringComparison.Ordinal))
                return "boolean";
            if (type.Contains("uuid", StringComparison.Ordinal))
                return "uuid";
            if (type.Contains("json", StringComparison.Ordinal))
                return "json";
            return "text";
        }

        private static string Humanize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            var spaced = Regex.Replace(value, "([a-z0-9])([A-Z])", "$1 $2")
                .Replace("_", " ", StringComparison.Ordinal)
                .Replace("-", " ", StringComparison.Ordinal)
                .Trim();
            return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(spaced.ToLowerInvariant());
        }

        private async Task<IActionResult?> EnsureReportsAccessAsync()
        {
            var roleName = User.FindFirstValue(ClaimTypes.Role);
            if (string.IsNullOrWhiteSpace(roleName))
                return Forbid();

            // This tool runs arbitrary SELECTs against any table in the public schema
            // with no per-tenant filtering - it must stay platform/root-admin-only,
            // the same gate every other cross-tenant admin tool uses (tenant admin,
            // billing, QA automation, digital marketing). A tenant's own "admin" role
            // must not be sufficient on its own.
            if (!await CurrentTenantIsRootAsync(HttpContext.RequestAborted))
                return Forbid();

            if (string.Equals(roleName, "admin", StringComparison.OrdinalIgnoreCase))
                return null;

            var normalizedRole = roleName.Trim().ToLowerInvariant();
            var hasAccess = await _db.RolePermissions
                .Join(_db.Roles,
                    permission => permission.RoleId,
                    role => role.Id,
                    (permission, role) => new { permission.PageKey, RoleName = role.Name })
                .AnyAsync(row =>
                    row.PageKey != null &&
                    row.PageKey.ToUpper() == ReportsPageKey &&
                    row.RoleName != null &&
                    row.RoleName.ToLower() == normalizedRole);

            return hasAccess ? null : Forbid();
        }

        private async Task<bool> CurrentTenantIsRootAsync(CancellationToken ct)
        {
            var tenantIdText = User.FindFirstValue("tenant_id");
            if (Guid.TryParse(tenantIdText, out var tenantId))
            {
                return await _db.Tenants
                    .AsNoTracking()
                    .Where(t => t.Id == tenantId)
                    .Select(t => t.IsRootTenant)
                    .FirstOrDefaultAsync(ct);
            }

            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            return tenant?.IsRootTenant == true;
        }

        private sealed class TableMetadata
        {
            public string Key { get; set; } = string.Empty;
            public string Schema { get; set; } = "public";
            public string Name { get; set; } = string.Empty;
            public long ApproximateRows { get; set; }
            public List<ColumnMetadata> Columns { get; } = new();
        }

        private sealed class ColumnMetadata
        {
            public string Name { get; set; } = string.Empty;
            public string DbType { get; set; } = string.Empty;
            public string UdtName { get; set; } = string.Empty;
            public string Kind { get; set; } = "text";
            public bool Nullable { get; set; }
            public int Ordinal { get; set; }
        }
    }

    public class ReportRunRequest
    {
        public string Cube { get; set; } = "users";
        public List<string>? Columns { get; set; }
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public string? DateField { get; set; }
        public List<string>? GroupBy { get; set; }
        public string? Measure { get; set; }
        public string Aggregation { get; set; } = "count";
        public List<ReportFilterDto>? Filters { get; set; }
        public string? SortBy { get; set; }
        public string? SortDir { get; set; } = "desc";
        public int Take { get; set; } = 500;
        public int Skip { get; set; }
    }

    public class ReportFilterDto
    {
        public string Field { get; set; } = string.Empty;
        public string Op { get; set; } = "contains";
        public string? Value { get; set; }
    }

    public class ReportRunResult
    {
        public string Cube { get; set; } = string.Empty;
        public DateTime GeneratedAtUtc { get; set; }
        public string Mode { get; set; } = "detail";
        public int TotalRows { get; set; }
        public int ReturnedRows { get; set; }
        public List<string> Columns { get; set; } = new();
        public List<Dictionary<string, object?>> Rows { get; set; } = new();
        public List<object> Metadata { get; set; } = new();
    }
}
