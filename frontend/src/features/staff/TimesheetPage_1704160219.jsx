import React, { useEffect, useState } from "react";
import api from "../../api";

export default function AttendanceTimesheetPage() {
  const [attendance, setAttendance] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [staff, setStaff] = useState([]);

  const [query, setQuery] = useState({ userId: "" });

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const currentUserId = user?.id;
  const currentUserName = user?.display || user?.username;
  const isAdmin = user?.role === "admin" || user?.role === 1;

  const todayStr = new Date().toISOString().slice(0, 10);

  const [attDraft, setAttDraft] = useState({
    date: todayStr,
    status: "Present",
    userId: currentUserId || "",
  });

  const [tsDraft, setTsDraft] = useState({
    date: todayStr,
    hours: "",
    task: "",
    userId: currentUserId || "",
  });

  // ================= FETCH =================

  const fetchData = async () => {
    try {
      const [attRes, tsRes] = await Promise.all([
        api.get("/attendance", { params: query }),
        api.get("/timesheets", { params: query }),
      ]);

      setAttendance(Array.isArray(attRes.data) ? attRes.data : []);
      setTimesheets(Array.isArray(tsRes.data) ? tsRes.data : []);
    } catch {
      setAttendance([]);
      setTimesheets([]);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await api.get("/users");
      setStaff(Array.isArray(res.data) ? res.data : []);
    } catch {
      setStaff([]);
    }
  };

  /*useEffect(() => {
    fetchData();
    fetchStaff();
  }, []);*/

useEffect(() => {
  const init = async () => {
    await fetchStaff();   // FIRST
    await fetchData();    // THEN
  };
  init();
}, []);

  // ================= VALIDATION =================

  /*const hasMarkedToday = attendance.some(
    (a) =>
      //a.userId === currentUserId &&
      String(a.userId) === String(currentUserId)
	a.date?.slice(0, 10) === todayStr
  );*/

const hasMarkedToday = attendance.some(
  (a) =>
    String(a.userId) === String(currentUserId) &&
    a.date?.slice(0, 10) === todayStr
);

  // ================= ACTIONS =================

  const markAttendance = async (status) => {
    if (hasMarkedToday) {
      alert("You have already marked attendance for today");
      return;
    }

   /* await api.post("/attendance", {
      date: new Date(),
      status,
    });*/
await api.post("/attendance", {
  date: new Date(),
  status,
  userId: currentUserId,
});
    fetchData();
  };

  const saveAttendance = async () => {
    const exists = attendance.some(
  (a) =>
    String(a.userId) === String(attDraft.userId) &&
    a.date?.slice(0, 10) === attDraft.date
);
    if (exists) {
      alert("Attendance already exists for this user & date");
      return;
    }

    const payload = { ...attDraft };
    if (!isAdmin) payload.userId = currentUserId;

    await api.post("/attendance", payload);
    fetchData();
  };

  const saveTimesheet = async () => {
    if (!tsDraft.hours || !tsDraft.task) {
      alert("Please enter hours and task");
      return;
    }

    const payload = { ...tsDraft };
    if (!isAdmin) payload.userId = currentUserId;

    await api.post("/timesheets", payload);
    fetchData();
  };

  const deleteAttendance = async (id) => {
    await api.delete(`/attendance/${id}`);
    fetchData();
  };

  const deleteTimesheet = async (id) => {
    await api.delete(`/timesheets/${id}`);
    fetchData();
  };

  // ================= HELPERS =================

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-IN") : "";

  /*const getUserName = (id) => {
    if (id === currentUserId) return currentUserName;
    const u = staff.find((s) => s.id === id);
    return u?.displayName || "Unknown User";
  };*/

const getUserName = (id) => {
  if (!id) return "Unknown User";

  const normalizedId = String(id).toLowerCase();

  const u = staff.find(
    (s) => String(s.id).toLowerCase() === normalizedId
  );

  return (
    u?.displayName ||
    u?.username ||
    (normalizedId === String(currentUserId).toLowerCase()
      ? currentUserName
      : "Unknown User")
  );
};

  // ================= UI =================

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* HEADER */}
      <div className="rounded-2xl p-6 text-white bg-gradient-to-r from-purple-600 to-pink-500 shadow">
        <h1 className="text-xl md:text-2xl font-bold">
          Timesheets & Attendance
        </h1>
        <p className="opacity-90 text-sm md:text-base">
          Log hours, mark attendance and track team activity
        </p>
      </div>

      {/* STAFF QUICK ACTION */}
      {!isAdmin && (
        <div className="bg-white p-5 rounded-2xl shadow">
          <h3 className="font-semibold mb-3">Today's Attendance</h3>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              disabled={hasMarkedToday}
              className={`px-4 py-2 rounded-xl text-white ${
                hasMarkedToday
                  ? "bg-gray-400"
                  : "bg-green-500 hover:bg-green-600"
              }`}
              onClick={() => markAttendance("Present")}
            >
              Mark Present
            </button>

            <button
              disabled={hasMarkedToday}
              className={`px-4 py-2 rounded-xl text-white ${
                hasMarkedToday
                  ? "bg-gray-400"
                  : "bg-red-500 hover:bg-red-600"
              }`}
              onClick={() => markAttendance("Absent")}
            >
              Mark Absent
            </button>
          </div>

          {hasMarkedToday && (
            <p className="text-sm text-gray-500 mt-2">
              Already marked today
            </p>
          )}
        </div>
      )}

      {/* ADMIN FILTER */}
      {isAdmin && (
        <div className="bg-white p-5 rounded-2xl shadow">
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              className="border p-2 rounded-xl"
              value={query.userId}
              onChange={(e) =>
                setQuery({ ...query, userId: e.target.value })
              }
            >
              <option value="">All Staff</option>
                 {Array.isArray(staff) && staff.map((u) => (
		<option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>

            <button
              className="bg-purple-600 text-white px-4 rounded-xl"
              onClick={fetchData}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* ATTENDANCE LIST */}
      <div className="bg-white p-5 rounded-2xl shadow">
        <h3 className="font-semibold mb-3">Attendance</h3>

        {attendance.map((a) => (
          <div
            key={a.id}
            className="flex justify-between items-center py-2 border-b text-sm"
          >
            <div>
              <strong>{getUserName(a.userId) || a.userId}</strong> •{" "}
              {formatDate(a.date)} •{" "}
              <span
                className={`px-2 py-1 rounded text-xs ${
                  a.status === "Present"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {a.status}
              </span>
            </div>

            <button
              className="text-red-500 text-xs"
              onClick={() => deleteAttendance(a.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* ADD TIMESHEET */}
      <div className="bg-white p-5 rounded-2xl shadow">
        <h3 className="font-semibold mb-3">Add Timesheet</h3>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="number"
            placeholder="Hours"
            className="border p-2 rounded-xl"
            onChange={(e) =>
              setTsDraft({ ...tsDraft, hours: e.target.value })
            }
          />

          <input
            placeholder="Task"
            className="border p-2 rounded-xl"
            onChange={(e) =>
              setTsDraft({ ...tsDraft, task: e.target.value })
            }
          />

          <button
            className="bg-purple-600 text-white px-4 rounded-xl"
            onClick={saveTimesheet}
          >
            Save
          </button>
        </div>
      </div>

      {/* TIMESHEET LIST */}
      <div className="bg-white p-5 rounded-2xl shadow">
        <h3 className="font-semibold mb-3">Timesheets</h3>

        {timesheets.map((t) => (
          <div
            key={t.id}
            className="flex justify-between items-center py-2 border-b text-sm"
          >
            <div>
              <strong>{getUserName(t.userId)}</strong> •{" "}
              {formatDate(t.date)} • {t.hours}h
            </div>

            <button
              className="text-red-500 text-xs"
              onClick={() => deleteTimesheet(t.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}