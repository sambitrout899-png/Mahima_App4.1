// src/main.jsx
// Native Android bootstrap: create notification channels + register FCM.
// Deferred so the login UI renders first before we request any permissions.
import { initNativeApp } from "./utils/initNativeApp";
window.addEventListener("load", () => setTimeout(initNativeApp, 2000));
import "./utils/fetch-auth-shim";   // <-- add this line first
import "./mobileUI.css";
import React from 'react'
import AutoLogoutWrapper from "./components/AutoLogoutWrapper";
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import axios from 'axios'
import { API_BASE } from './api'
import { LanguageProvider } from './i18n/LanguageContext'
import { mobileClientHeaders } from './utils/mobileAccessPolicy'
import GlobalNotifications from './components/GlobalNotifications'
import { notifyError, notifySuccess, defaultActionMessage } from './utils/notifications'

function normalizeDuplicateApiPath(value) {
  return typeof value === 'string'
    ? value.replace(/\/api(?:\/api)+(?=\/|[?#]|$)/gi, '/api')
    : value
}

function installDuplicateApiPathGuard() {
  try {
    if (window.__mahimaDuplicateApiPathGuardInstalled) return
    window.__mahimaDuplicateApiPathGuardInstalled = true

    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (typeof input === 'string') {
        return nativeFetch(normalizeDuplicateApiPath(input), init)
      }

      if (input instanceof Request) {
        const normalizedUrl = normalizeDuplicateApiPath(input.url)
        if (normalizedUrl !== input.url) {
          return nativeFetch(new Request(normalizedUrl, input), init)
        }
      }

      return nativeFetch(input, init)
    }
  } catch (error) {
    console.warn('Failed to install duplicate API path guard', error)
  }
}

installDuplicateApiPathGuard()

// ✅ Create the QueryClient (used by react-query)
const qc = new QueryClient()

// ---------- Axios: Global Auth Interceptor ----------
function attachAxiosAuthInterceptor() {
  try {
    if (window.__mahimaAxiosInterceptorsInstalled) return
    window.__mahimaAxiosInterceptorsInstalled = true
    axios.interceptors.request.use(
      (config) => {
        try {
          const url = normalizeDuplicateApiPath(String(config.url || ''))
          config.url = url
          const apiOrigin = (API_BASE || '/api').replace(/\/api\/?$/i, '').replace(/\/+$/, '')

          if (url && !/^https?:\/\//i.test(url)) {
            if (url.startsWith('/api/')) {
              config.url = `${apiOrigin}${url}`
            } else if (url.startsWith('/')) {
              config.url = `${API_BASE}${url}`
            }
          }
          config.url = normalizeDuplicateApiPath(config.url)
        } catch (e) {
          console.warn('Axios URL interceptor failed', e)
        }

        try {
          config.headers = config.headers || {}
          Object.assign(config.headers, mobileClientHeaders())
          // ✅ Primary key: authToken
          let token = localStorage.getItem('authToken')

          // ✅ Fallback: legacy keys
          if (!token)
            token =
              localStorage.getItem('token') ||
              localStorage.getItem('mahima_token')

          // ✅ Attach Bearer token correctly
          if (token) {
            token = token.trim()
            config.headers = config.headers || {}
            config.headers.Authorization = token.startsWith('Bearer ')
              ? token
              : `Bearer ${token}`
          }
        } catch (e) {
          console.warn(
            'Axios auth interceptor: failed to read token',
            e
          )
        }

        return config
      },
      (err) => Promise.reject(err)
    )
    axios.interceptors.response.use(
      (response) => {
        const method = String(response?.config?.method || 'get').toUpperCase()
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && response?.config?.mahimaNotify !== false) {
          notifySuccess(response?.config?.successMessage || defaultActionMessage(method, response?.config?.url))
        }
        return response
      },
      (error) => {
        if (error?.config?.mahimaNotify !== false) notifyError(error, 'The action could not be completed.')
        return Promise.reject(error)
      }
    )
  } catch (e) {
    console.warn('Failed to attach axios interceptor', e)
  }
}

// ✅ Attach interceptor once at startup
attachAxiosAuthInterceptor()

// ✅ Optional helper for refreshing interceptor after login
export function refreshAxiosAuth() {
  attachAxiosAuthInterceptor()
}
// -------------------------------------------------------------------------

function installStaleBundleRecovery() {
  try {
    if (window.__mahimaStaleBundleRecoveryInstalled) return
    window.__mahimaStaleBundleRecoveryInstalled = true

    const reloadKey = 'mahima:stale-bundle-reload-at'
    const isStaleBundleError = (value) => {
      const text = String(value?.message || value?.reason?.message || value || '')
      return (
        text.includes('Failed to fetch dynamically imported module') ||
        text.includes('Importing a module script failed') ||
        text.includes('Expected a JavaScript-or-Wasm module script') ||
        text.includes('Strict MIME type checking is enforced for module scripts')
      )
    }

    const reloadOnce = () => {
      const lastReload = Number(sessionStorage.getItem(reloadKey) || 0)
      if (Date.now() - lastReload < 60000) return
      sessionStorage.setItem(reloadKey, String(Date.now()))
      window.location.reload()
    }

    window.addEventListener('error', (event) => {
      if (isStaleBundleError(event?.error || event?.message)) reloadOnce()
    })

    window.addEventListener('unhandledrejection', (event) => {
      if (isStaleBundleError(event)) reloadOnce()
    })
  } catch {}
}

installStaleBundleRecovery()

function redirectBrowserPathToHashRoute() {
  try {
    if (window.location.hash) return
    const path = window.location.pathname || '/'
    const hashRoutes = ['/login', '/reset-password', '/saas', '/app-downloads', '/home', '/t/']
    const shouldRedirect = hashRoutes.some((route) =>
      route.endsWith('/') ? path.startsWith(route) : path === route || path.startsWith(`${route}/`)
    )
    if (!shouldRedirect) return

    const next = `${window.location.origin}/#${path}${window.location.search || ''}`
    window.location.replace(next)
  } catch {}
}

redirectBrowserPathToHashRoute()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <AutoLogoutWrapper>
            <GlobalNotifications />
            <App />
          </AutoLogoutWrapper>
        </LanguageProvider>
      </QueryClientProvider>
    </HashRouter>
  </React.StrictMode>
)
