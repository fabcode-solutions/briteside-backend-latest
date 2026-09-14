import { z } from 'zod';

// User registration schema
export const insertUserSchema = z.object({
  body: z.object({
    phoneNumber: z
      .string()
      .trim()
      .min(1, { message: 'Phone number is required' })
      .regex(/^\+?[1-9]\d{7,14}$/, { message: 'Please enter a valid phone number' }),
    email: z.string().email({ message: 'Please enter a valid email address' }).optional(),
    password: z
      .string()
      .min(8, { message: 'Password must be at least 8 characters long' })
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message:
          'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      }),
    firstName: z
      .string()
      .trim()
      .min(1, { message: 'First name is required' })
      .max(100, { message: 'First name cannot exceed 100 characters' }),
    lastName: z
      .string()
      .trim()
      .min(1, { message: 'Last name is required' })
      .max(100, { message: 'Last name cannot exceed 100 characters' }),
    username: z
      .string()
      .trim()
      .min(3, { message: 'Username must be at least 3 characters' })
      .max(50, { message: 'Username cannot exceed 50 characters' })
      .regex(/^[a-zA-Z0-9_]+$/, {
        message: 'Username can only contain letters, numbers, and underscores',
      }),
dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be in YYYY-MM-DD format' })
      .refine(
        date => {
          const birthDate = new Date(date);
          return birthDate.getTime() <= Date.now();
        },
        { message: 'Date of birth cannot be in the future' }
      )
      .refine(
        date => {
          const birthDate = new Date(date);
          const today = new Date();
          const age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          const dayDiff = today.getDate() - birthDate.getDate();
          const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
          return actualAge >= 13;
        },
        { message: 'You must be at least 13 years old' }
      ),
  }),
});

// User login schema
export const loginUserSchema = z.object({
  body: z.object({
    usernameOrEmail: z.string().min(1, { message: 'Username, email, or phone number is required' }),
    password: z.string().min(1, { message: 'Password is required' }),
  }),
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
  body: z.object({
    usernameOrEmail: z.string().min(1, { message: 'Username, email, or phone number is required' }),
  }),
});

// Reset password schema
export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, { message: 'Reset token is required' }),
    password: z
      .string()
      .min(8, { message: 'Password must be at least 8 characters long' })
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message:
          'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      }),
  }),
});

// Logout token schema
export const logoutTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, { message: 'Refresh token is required' }),
  }),
});

// Refresh token schema
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, { message: 'Refresh token is required' }),
});
