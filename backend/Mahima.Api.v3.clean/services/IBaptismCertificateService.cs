using System.Threading.Tasks;
using Mahima.Api.v3.clean.Models;

namespace Mahima.Api.v3.clean.Services
{
    public interface IBaptismCertificateService
    {
        /// <summary>
        /// Generates a baptism certificate PDF for the given request, saves it under a
        /// private, tenant-scoped, non-web-exposed directory, and returns a relative path
        /// (e.g. "{tenantId}/BaptismCertificate_1_20251121030000.pdf") for BaptismsController's
        /// authenticated, tenant-checked download endpoint to resolve -- never a public URL.
        /// </summary>
        Task<string> GenerateCertificateAsync(BaptismRequest request);
    }
}
