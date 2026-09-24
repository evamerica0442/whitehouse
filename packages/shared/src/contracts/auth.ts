import { z } from 'zod';

import { ADMIN_ROLES } from '../enums';
import { emailField, uuidField } from './common';

export const adminRoleSchema = z.enum(ADMIN_ROLES);

export const loginInputSchema = z.object({
  email: emailField,
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: uuidField,
  email: z.string(),
  name: z.string(),
  role: adminRoleSchema,
  lastLoginAt: z.iso.datetime().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authSessionResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.iso.datetime(),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const magicLinkRequestSchema = z.object({ email: emailField });
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkConsumeSchema = z.object({ token: z.string().min(16).max(512) });
export type MagicLinkConsumeInput = z.infer<typeof magicLinkConsumeSchema>;

export const createUserInputSchema = z.object({
  email: emailField,
  name: z.string().min(1).max(120),
  role: adminRoleSchema,
  /** Optional: when omitted the user is created without a password and must use magic links. */
  password: z.string().min(12).max(200).optional(),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: adminRoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
