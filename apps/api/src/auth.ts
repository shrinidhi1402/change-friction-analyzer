import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export type AuthUser = { id: string; email: string; name: string };

export const hashPassword = async (password: string): Promise<string> => bcrypt.hash(password, 10);
export const comparePassword = async (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);

export const createToken = (user: AuthUser): string => jwt.sign(user, config.jwtSecret, { expiresIn: '7d' });
export const verifyToken = (token: string): AuthUser => jwt.verify(token, config.jwtSecret) as AuthUser;
