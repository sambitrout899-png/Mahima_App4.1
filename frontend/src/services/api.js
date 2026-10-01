import axios from 'axios';
import { API_BASE } from '../config';
import { tenantLoginHref } from '../utils/tenantNavigation';

const api = axios.create({ baseURL: API_BASE });

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = tenantLoginHref();
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);

export const register = (payload) =>
  api.post('/auth/register', payload).then((r) => r.data);

// ── Chats ────────────────────────────────────────────────────────────────────
export const getChats = () => api.get('/chats').then((r) => r.data);

export const getOrCreateDirectChat = (otherUserId) =>
  api.post('/chats', { memberIds: [otherUserId] }).then((r) => r.data);

export const getMessages = (chatId, page = 1, pageSize = 50) =>
  api.get(`/chats/${chatId}/messages`, { params: { page, pageSize } }).then((r) => r.data);

export const sendMessage = (chatId, content, contentType = 'text') =>
  api.post(`/chats/${chatId}/messages`, { content, contentType }).then((r) => r.data);

export const markRead = (chatId) =>
  api.post(`/chats/${chatId}/read`).then((r) => r.data);

// ── Users ────────────────────────────────────────────────────────────────────
export const getUsers = () => api.get('/users').then((r) => r.data);

export const getMe = () => api.get('/users/me').then((r) => r.data);

export const updateFcmToken = (token) =>
  api.post('/users/fcm-token', { token }).then((r) => r.data);

// ── Notifications ────────────────────────────────────────────────────────────
export const getNotifications = () =>
  api.get('/notifications').then((r) => r.data);

export const markNotificationRead = (id) =>
  api.patch(`/notifications/${id}/read`).then((r) => r.data);

// ── Prayer Requests ──────────────────────────────────────────────────────────
export const getPrayerRequests = () =>
  api.get('/prayer-requests').then((r) => r.data);

// ── Meetings ─────────────────────────────────────────────────────────────────
export const getMeetings = () => api.get('/meetings').then((r) => r.data);
