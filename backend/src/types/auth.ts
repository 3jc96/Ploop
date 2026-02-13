export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
