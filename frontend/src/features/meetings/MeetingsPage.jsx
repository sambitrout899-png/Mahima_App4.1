import React, { useEffect, useState } from "react";
import { meetingsApi } from "../../meetings";

function pretty(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);
  try { return JSON.stringify(val); } catch { return String(val); }
}
function capitalize(s) { if (!s) return ""; return s.charAt(0).toUpperCase() + s.slice(1); }

export default function MeetingsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});
  const preferred = ["id","Id","name","email","title","role","createdAt","updatedAt"];

  useEffect(()=>{ load(); }, []);

  async function load(){
    setLoading(true); setError(null);
    try {
      let data = await meetingsApi.list();
      if (!data) data = [];
      if (!Array.isArray(data) && data.items && Array.isArray(data.items)) data = data.items;
      if (!Array.isArray(data) && data.data && Array.isArray(data.data)) data = data.data;
      setRows(data);
    } catch(e){ console.error(e); setError(e.message || "Failed to load"); }
    finally{ setLoading(false); }
  }

  const columns = React.useMemo(()=>{
    const keys = new Set();
    rows.forEach(r=>{ if (r && typeof r === 'object') Object.keys(r).forEach(k=>keys.add(k)); });
    const rest = [...keys].filter(k=>!preferred.includes(k)).sort((a,b)=>a.localeCompare(b));
    return preferred.filter(k=>keys.has(k)).concat(rest);
  }, [rows]);

  function openAdd(){
    // initialise form with empty values for each column if we have columns
    const obj = {};
    if (columns && columns.length>0){ columns.forEach(c=>{ if (c !== 'id' && c !== 'Id') obj[c] = ''; }); }
    else { obj['name']=''; obj['title']=''; }
    setForm(obj); setShowForm(true);
  }

  async function save(){
    try{
      // remove empty string id fields
      const payload = { ...form };
      // attempt create
      await meetingsApi.create(payload);
      setShowForm(false); setForm({}); await load();
    } catch(e){ console.error(e); alert('Create failed: ' + (e.message||e)); }
  }

  async function onDelete(row){
    const id = row.id || row.Id;
    if (!id) return alert('No id present');
    if (!confirm('Delete this record?')) return;
    try{ await meetingsApi.remove(id); await load(); } catch(e){ console.error(e); alert(e.message||'Delete failed'); }
  }

  function renderFormInputs(){
    const keys = columns && columns.length? columns.filter(c=>c !== 'id' && c !== 'Id') : ['name','title'];
    return keys.map(k => (
      <div className="mb-2" key={k}>
        <label className="block text-sm font-medium mb-1">{capitalize(k)}</label>
        <input value={form[k] || ''} onChange={e=>setForm({...form,[k]: e.target.value})} className="w-full border px-2 py-1 rounded" />
      </div>
    ));
  }

  return (
    <div className="p-6 bg-red-50 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Meetings</h2>
        <div className="flex gap-2">
          <button onClick={openAdd} className="px-3 py-2 bg-red-600 text-white rounded">Add Record</button>
          <button onClick={load} className="px-3 py-2 border rounded">Refresh</button>
        </div>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-white border rounded shadow-sm">
          <h3 className="font-semibold mb-2">Add Record</h3>
          {renderFormInputs()}
          <div className="flex gap-2 mt-2">
            <button onClick={save} className="px-3 py-1 bg-indigo-600 text-white rounded">Save</button>
            <button onClick={()=>{ setShowForm(false); setForm({}); }} className="px-3 py-1 border rounded">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div>Loading…</div>}
      {error && <div className="text-red-700 mb-4">Error: {error}</div>}

      <div className="overflow-x-auto bg-white rounded shadow-sm">
        <table className="min-w-full table-auto">
          <thead className="bg-red-100">
            <tr>
              {columns.map(col => (<th key={col} className="text-left px-4 py-3 text-sm font-medium">{capitalize(col)}</th>))}
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={columns.length+1} className="p-4 text-center text-gray-500">No records</td></tr>
            )}
            {rows.map((row,idx)=> (
              <tr key={row.id || row.Id || idx} className="border-t border-red-100 hover:bg-red-50">
                {columns.map(col => (<td key={col} className="px-4 py-3 align-top text-sm"><div className="truncate max-w-xl">{pretty(row[col])}</div></td>))}
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={()=>alert(JSON.stringify(row,null,2))} className="text-blue-600">View</button>
                    <button onClick={()=>onDelete(row)} className="text-red-600">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}