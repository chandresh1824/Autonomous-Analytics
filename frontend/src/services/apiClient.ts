import axios, { AxiosError } from 'axios';
import type { ApiErrorBody } from '@/types/api';
import { markReauthRequired } from '@/auth/sessionState';
import { getApiAuthHeaders } from './authHeaders';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Attaches the Entra access token to every API call (see `getApiAuthHeaders`). */
apiClient.interceptors.request.use(async (config) => {
  const headers = await getApiAuthHeaders();
  if (headers.Authorization) {
    config.headers.set('Authorization', headers.Authorization);
  }
  return config;
});

/** A 401 means the sign-in is no longer accepted - offer to renew it in place. */
apiClient.interceptors.response.use(undefined, (error) => {
  if (axios.isAxiosError(error) && error.response?.status === 401) markReauthRequired();
  return Promise.reject(error);
});

/**
 * Extracts a human-readable message from an axios/FastAPI error response.
 */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<ApiErrorBody>;
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => d.msg).join(', ') || fallback;
    }
    if (err.message) return err.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
