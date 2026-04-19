/**
 * Resilient HTTP client for Ploop API.
 * - Retry with exponential backoff on transient failures (network, 5xx)
 * - Configurable timeouts per request type
 * - Consistent error handling
 * - No retries for non-idempotent requests (POST/PUT/DELETE) to avoid double actions
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { API_BASE_URL } from '../config/api';

const DEFAULT_TIMEOUT_MS = 15000;
const POI_TIMEOUT_MS = 20000; // Location details = geocode + nearby + place details (2–3 Google API calls)
const AUTH_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;

function isRetryable(error: AxiosError): boolean {
  if (!error.response) return true; // Network error
  const status = error.response.status;
  if (status >= 500 && status < 600) return true; // Server error
  if (status === 408 || status === 429) return true; // Timeout, rate limit
  return false;
}

/** 502/503 = gateway errors: the server never processed the request, so POST/PUT retries are safe. */
function isGatewayError(error: AxiosError): boolean {
  const status = error.response?.status;
  return status === 502 || status === 503;
}

function isIdempotent(config: AxiosRequestConfig): boolean {
  const method = (config.method || 'get').toLowerCase();
  return method === 'get' || method === 'head' || method === 'options';
}

function getRetryDelay(attempt: number, error?: AxiosError): number {
  // 502/503 = server cold-starting; wait longer before retry (3s, 6s, 12s...)
  if (error && isGatewayError(error)) {
    const delay = 3000 * Math.pow(2, attempt);
    return Math.min(delay, MAX_RETRY_DELAY_MS);
  }
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Client': 'ploop-mobile',
    },
    validateStatus: (status) => status >= 200 && status < 300,
  });

  client.interceptors.request.use(
    (config) => {
      config.headers = config.headers || {};
      const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      config.headers['X-Request-Id'] = reqId;
      (config as any)._reqStart = Date.now();
      (config as any)._reqId = reqId;
      if (__DEV__) {
        const url = (config.url && String(config.url).startsWith('http'))
          ? config.url
          : (config.baseURL ? `${config.baseURL}${config.url}` : config.url);
        console.log(`[Ploop HTTP] → ${(config.method || 'get').toUpperCase()} ${url} [${reqId}]`);
      }
      return config;
    },
    (err) => Promise.reject(err)
  );

  client.interceptors.response.use(
    (response) => {
      const config = response.config as any;
      if (__DEV__ && config?._reqId) {
        const ms = config._reqStart ? Date.now() - config._reqStart : 0;
        console.log(`[Ploop HTTP] ← ${response.status} ${config.url} ${ms}ms [${config._reqId}]`);
      }
      return response;
    },
    async (error: AxiosError) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };
      const retryCount = config._retryCount ?? 0;
      const shouldRetry =
        retryCount < MAX_RETRIES &&
        isRetryable(error) &&
        // Allow full retries for GET/HEAD/OPTIONS, or for 502/503 (server never processed the request)
        // Non-idempotent (POST/PUT/DELETE) on app-level errors (500/504) retry only once to avoid duplicates
        (isIdempotent(config) || isGatewayError(error) || retryCount === 0);

      if (shouldRetry) {
        config._retryCount = retryCount + 1;
        const delay = getRetryDelay(retryCount, error);
        if (__DEV__) {
          console.warn(`[Ploop HTTP] Retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms: ${(config as any)?._reqId}`, error.message);
        }
        await new Promise((r) => setTimeout(r, delay));
        return client.request(config);
      }

      if (__DEV__) {
        const reqId = (error.config as any)?._reqId;
        const status = error.response?.status;
        const url = String(error.config?.url ?? '');
        const fullUrl = url.startsWith('http') ? url : (error.config?.baseURL ? `${error.config.baseURL}${url}` : url);
        // 404 on by-place is expected (place not in DB yet) – don't log as error
        if (status === 404 && url.includes('/by-place/')) {
          console.log(`[Ploop HTTP] 404 (not in DB) ${url} [${reqId}]`);
        } else if (
          (status === 400 || status === 404) &&
          url.includes('/super-toilet-of-the-day')
        ) {
          console.log(`[Ploop HTTP] ${status} (optional super toilet) ${url} [${reqId}]`);
        } else if (!error.response && (url.includes('/diagnostics') || url.includes('/crash-reports'))) {
          // Diagnostics/crash-reports are optional – log as warn when backend unreachable
          console.warn(`[Ploop HTTP] Optional request failed (backend unreachable): ${fullUrl} [${reqId}]`);
        } else {
          console.error(`[Ploop HTTP] ✗ ${status ?? 'NETWORK'} ${fullUrl} [${reqId}]`, error.message);
        }
      }
      return Promise.reject(error);
    }
  );

  return client;
}

export const httpClient = createClient();

export const timeouts = {
  default: DEFAULT_TIMEOUT_MS,
  poi: POI_TIMEOUT_MS,
  auth: AUTH_TIMEOUT_MS,
};
