import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const comparePassword = (password, hash) => bcrypt.compare(password, hash);
export const signToken = (user) => jwt.sign({ sub: user.id, sessionVersion: user.updatedAt?.getTime() }, env.JWT_SECRET, { expiresIn: '2h' });
export const publicUser = ({ passwordHash, ...user }) => user;