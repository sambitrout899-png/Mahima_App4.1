import api from "../api";

const ROOT = "/api/admin/qa";
const value = (result) => result?.data ?? result;

export async function getQaCatalog() { return value(await api.get(`${ROOT}/catalog`)); }
export async function getQaRuns() { return value(await api.get(`${ROOT}/runs`)); }
export async function getQaRun(id) { return value(await api.get(`${ROOT}/runs/${id}`)); }
export async function generateQaPlan(modules, name = "") { return value(await api.post(`${ROOT}/plans/generate`, { modules, name })); }
export async function getQaPlan(id) { return value(await api.get(`${ROOT}/plans/${id}`)); }
export async function approveQaPlan(id, cases, loadTest) { return value(await api.put(`${ROOT}/plans/${id}/review`, { cases, loadTest })); }
export async function runApprovedQaPlan(id) { return value(await api.post(`${ROOT}/plans/${id}/run`, {})); }
export async function getSolutionReport(id) { return value(await api.get(`${ROOT}/runs/${id}/solution-report`)); }
export async function getSecurityMonitorStatus() { return value(await api.get(`${ROOT}/security/status`)); }
export async function getSecurityMonitorRuns() { return value(await api.get(`${ROOT}/security/runs`)); }
export async function getSecurityMonitorRun(id) { return value(await api.get(`${ROOT}/security/runs/${id}`)); }
export async function runSecurityMonitorNow() { return value(await api.post(`${ROOT}/security/run-now`, {})); }
