using System.Text.Json;
using System.Reflection;
using Mahima.Api.v3.clean.Controllers;
using Microsoft.AspNetCore.Mvc.ActionConstraints;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

// Discover actual MVC actions without starting the application, hosted jobs, or a database.
var services = new ServiceCollection();
services.AddLogging();
services.AddControllers().AddApplicationPart(typeof(EventsController).Assembly);
using var provider = services.BuildServiceProvider();
var actions = provider.GetRequiredService<IActionDescriptorCollectionProvider>().ActionDescriptors.Items
    .OfType<ControllerActionDescriptor>()
    .SelectMany(a => (a.ActionConstraints?.OfType<HttpMethodActionConstraint>().SelectMany(c => c.HttpMethods)
        ?? new[] { "ANY" }).Select(method => new {
            method, route = a.AttributeRouteInfo?.Template, controller = a.ControllerName, action = a.ActionName
        })).Where(a => a.route != null).OrderBy(a => a.route).ThenBy(a => a.method).ToArray();
var output = args.FirstOrDefault() ?? "routes.json";
File.WriteAllText(output, JsonSerializer.Serialize(actions, new JsonSerializerOptions { WriteIndented = true }));

var routeSet = actions.Select(a => $"{a.method.ToUpperInvariant()} {a.route!.ToLowerInvariant()}").ToHashSet();
var requiredRoutes = new[] {
    "GET api/events", "POST api/events", "GET api/events/{id:long}", "PUT api/events/{id:long}",
    "DELETE api/events/{id:long}", "PATCH api/events/{id:long}/status", "POST api/events/{id:long}/rsvp",
    "DELETE api/events/{id:long}/rsvp", "GET api/events/{id:long}/rsvps",
    "GET api/volunteer-shifts", "POST api/volunteer-shifts", "PUT api/volunteer-shifts/{id:long}",
    "DELETE api/volunteer-shifts/{id:long}", "POST api/volunteer-shifts/{id:long}/signup",
    "DELETE api/volunteer-shifts/{id:long}/signup", "GET api/volunteer-shifts/{id:long}/signups",
    "GET api/checkin/active", "GET api/checkin/history", "POST api/checkin",
    "POST api/checkin/{id:long}/checkout", "DELETE api/checkin/{id:long}",
    "GET api/service-plans", "POST api/service-plans", "GET api/service-plans/{id:long}",
    "PUT api/service-plans/{id:long}", "DELETE api/service-plans/{id:long}",
    "GET api/auth/mfa/status", "POST api/auth/mfa/setup", "POST api/auth/mfa/verify-setup",
    "POST api/auth/mfa/disable", "POST api/auth/mfa/login-verify",
    "GET api/admin/qa/security/status", "GET api/admin/qa/security/runs",
    "GET api/admin/qa/security/runs/{id:guid}", "POST api/admin/qa/security/run-now"
};
var missingRoutes = requiredRoutes.Where(route => !routeSet.Contains(route)).ToArray();
if (missingRoutes.Length > 0) throw new Exception($"Missing module routes: {string.Join(", ", missingRoutes)}");

var expectedPageModules = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
    ["EVENTS"] = "care_ministry", ["VOLUNTEERS"] = "operations",
    ["CHECKIN"] = "care_ministry", ["SERVICE_PLANS"] = "care_ministry"
};
foreach (var controllerType in new[] { typeof(PagesController), typeof(RolesController), typeof(AuthController) }) {
    var field = controllerType.GetField("PageModules", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new Exception($"{controllerType.Name}.PageModules is missing.");
    var map = (IReadOnlyDictionary<string, string>)field.GetValue(null)!;
    foreach (var expected in expectedPageModules)
        if (!map.TryGetValue(expected.Key, out var module) || module != expected.Value)
            throw new Exception($"{controllerType.Name} maps {expected.Key} inconsistently.");
    var baseField = controllerType.GetField("BasePageKeys", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new Exception($"{controllerType.Name}.BasePageKeys is missing.");
    if (!((string[])baseField.GetValue(null)!).Contains("SECURITY"))
        throw new Exception($"{controllerType.Name} does not expose SECURITY as a base page.");
}
var packageField = typeof(MultiTenantController).GetField("PackagePageModules", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new Exception("PackagePageModules is missing.");
var packageMap = (IReadOnlyDictionary<string, string>)packageField.GetValue(null)!;
foreach (var expected in expectedPageModules.Append(new KeyValuePair<string, string>("SECURITY", "base")))
    if (!packageMap.TryGetValue(expected.Key, out var module) || module != expected.Value)
        throw new Exception($"Package catalog maps {expected.Key} inconsistently.");

var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var shift = JsonSerializer.Deserialize<VolunteerSchedulingController.ShiftCreateDto>(
    """{"title":"Sunday","shiftDate":"2026-09-14","startTime":"07:18:00","endTime":null,"slotsNeeded":1}""", json)!;
if (shift.StartTime != new TimeSpan(7, 18, 0)) throw new Exception("Volunteer time contract failed.");
var browserShift = JsonSerializer.Deserialize<VolunteerSchedulingController.ShiftCreateDto>(
    """{"startTime":"07:18"}""", json)!;
if (browserShift.StartTime != new TimeSpan(7, 18, 0)) throw new Exception("Browser volunteer time contract failed.");
var child = JsonSerializer.Deserialize<CheckInController.CheckInDto>(
    """{"childName":"Test","guardianName":"Guardian","childDob":null}""", json)!;
if (child.ChildDob != null) throw new Exception("Optional child DOB contract failed.");
var plan = JsonSerializer.Deserialize<ServicePlansController.ServicePlanCreateDto>(
    """{"title":"Sunday","serviceDate":"2026-09-14","items":[{"itemType":"song","title":"Opening","durationMinutes":5}]}""", json)!;
if (plan.Items?.Count != 1 || plan.Items[0].DurationMinutes != 5) throw new Exception("Service plan contract failed.");
// Empty HTML date inputs must be normalized before they reach the backend serializer.
try { JsonSerializer.Deserialize<CheckInController.CheckInDto>("""{"childDob":""}""", json); }
catch (JsonException) { Console.WriteLine("Confirmed empty child DOB requires frontend normalization."); goto NormalizationConfirmed; }
throw new Exception("Expected an empty child DOB to be rejected.");
NormalizationConfirmed:
Console.WriteLine($"Exported {actions.Length} MVC routes; all {requiredRoutes.Length} module routes and payload checks passed.");
