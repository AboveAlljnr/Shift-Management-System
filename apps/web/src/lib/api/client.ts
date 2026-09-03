import axios, { AxiosError } from 'axios';

// API base URL is explicitly environment-driven. NEXT_PUBLIC_API_URL is inlined at build
// time. It MUST be provided for production/staging builds (see next.config.js guard); the
// fallback here is for local development only and points at the actual dev API port (3001),
// NOT a silent production default.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach access token
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 / token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const axiosError = error as AxiosError<unknown> & { config: { _retry?: boolean } };
    if (axiosError.response?.status === 401 && !axiosError.config._retry) {
      axiosError.config._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post<{
          data: { accessToken: string; refreshToken: string };
        }>(`${API_BASE}/api/v1/auth/refresh`, { refreshToken });

        localStorage.setItem('accessToken', data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);

        axiosError.config.headers = {
          ...(axiosError.config.headers as Record<string, string>),
          Authorization: `Bearer ${data.data.accessToken}`,
        } as unknown as typeof axiosError.config.headers;

        return apiClient.request(axiosError.config);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
