import React from "react";
import { API_BASE } from "../../api";
export default function CounsellingRequestModal({ open, onClose }) {
  const [form, setForm] = React.useState({
    fullName: "",
    email: "",
    phone: "",
    issueCategory: "",
    description: "",
    isChurchMember: false,
  });
  const [loading, setLoading] = React.useState(false);
  const [response, setResponse] = React.useState(null);
  const [error, setError] = React.useState(null);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
//      const res = await fetch("/counselling/requests", {
  const res = await fetch(`${API_BASE}/counselling/requests`, { 	
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) throw new Error("Unable to submit request");

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        {!response ? (
          <>
            <h2 className="text-xl font-semibold mb-4 text-pink-600">
              Request Pastoral Counselling
            </h2>
            {error && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl p-2">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                name="fullName"
                placeholder="Full name"
                className="w-full border rounded-xl px-3 py-2"
                onChange={handleChange}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  name="email"
                  type="email"
                  placeholder="Email (optional)"
                  className="w-full border rounded-xl px-3 py-2"
                  onChange={handleChange}
                />
                <input
                  name="phone"
                  placeholder="Phone"
                  className="w-full border rounded-xl px-3 py-2"
                  onChange={handleChange}
                  required
                />
              </div>
              <select
                name="issueCategory"
                className="w-full border rounded-xl px-3 py-2"
                onChange={handleChange}
                required
              >
                <option value="">Select category</option>
                <option>Marriage &amp; Family</option>
                <option>Healing &amp; Deliverance</option>
                <option>Financial</option>
                <option>Depression / Anxiety</option>
                <option>Spiritual Growth</option>
                <option>Other</option>
              </select>
              <textarea
                name="description"
                placeholder="Briefly share what you need counselling for"
                rows={3}
                className="w-full border rounded-xl px-3 py-2"
                onChange={handleChange}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="isChurchMember"
                  onChange={handleChange}
                />
                I am part of Mahima Ministry fellowship
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full border border-emerald-700 bg-emerald-50 text-emerald-800 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 rounded-full bg-gradient-to-r from-emerald-700 to-emerald-600 text-white font-semibold disabled:opacity-60"
                >
                  {loading ? "Submitting..." : "Submit request"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="text-center space-y-3">
            <h2 className="text-xl font-semibold text-green-600">
              Request received
            </h2>
            <p className="text-sm text-gray-600">
              Our pastoral team will review your request and contact you with a
              counselling date and token.
            </p>
            <div className="bg-green-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">Your Request Code</p>
              <p className="font-mono text-lg">{response.requestCode}</p>
            </div>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 rounded-full bg-emerald-700 text-white font-semibold"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
