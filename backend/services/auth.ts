import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { COLLECTIONS, User } from '../database/schemas.js';

const JWT_SECRET = process.env.JWT_TOKEN || 'dev-secret-key-change-in-production';
const SALT_ROUNDS = 12;

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  token?: string;
  user?: {
    id: string;
    email: string;
    username: string;
    isAdmin: boolean;
  };
  error?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
}

export const auth_service = {
  /**
   * Hash a password using bcrypt
   */
  async hash_password(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  /**
   * Verify a password against its hash
   */
  async verify_password(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  /**
   * Generate a JWT token for a user
   */
  generate_token(user_id: string): string {
    return jwt.sign(
      { userId: user_id },
      JWT_SECRET,
      { expiresIn: '7d' } // 7 days
    );
  },

  /**
   * Verify and decode a JWT token
   */
  verify_token(token: string): { userId: string } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as { userId: string };
    } catch (error) {
      return null;
    }
  },

  /**
   * Register a new user
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const db = get_database();
    
    try {
      // Validate input
      if (!input.email || !input.password) {
        return { success: false, error: 'Email and password required' };
      }
      
      if (input.password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }

      const email = input.email.toLowerCase().trim();
      
      // Check if user already exists
      const existing_user = await db.collection(COLLECTIONS.users).findOne({
        email
      });
      
      if (existing_user) {
        return { success: false, error: 'Email already registered' };
      }

      // Generate username from email
      const username = input.displayName || email.split('@')[0];
      
      // Hash password
      const password_hash = await this.hash_password(input.password);
      
      // Create user document
      const now = new Date();
      const user_doc: User = {
        email,
        username,
        password_hash,
        is_admin: false,
        is_verified: false,
        kyc_status: 'none',
        position_limit_usd: 10000, // $10k default limit
        is_suspended: false,
        created_at: now,
        updated_at: now
      };

      // Insert user
      const insert_result = await db.collection(COLLECTIONS.users).insertOne(user_doc);
      const user_id = insert_result.insertedId.toString();
      
      // Initialize user wallet and balance
      await this.initialize_user_wallet(user_id);
      
      // Generate token
      const token = this.generate_token(user_id);
      
      return {
        success: true,
        userId: user_id,
        token,
        user: {
          id: user_id,
          email,
          username,
          isAdmin: false
        }
      };
    } catch (error: any) {
      console.error('Registration error:', error);
      return { success: false, error: 'Registration failed' };
    }
  },

  /**
   * Login an existing user
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const db = get_database();
    
    try {
      const email = input.email.toLowerCase().trim();
      
      // Find user by email
      const user = await db.collection(COLLECTIONS.users).findOne({
        email
      }) as User | null;

      if (!user || !user.password_hash) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Check if user is suspended
      if (user.is_suspended) {
        return { success: false, error: 'Account is suspended' };
      }

      // Verify password
      const password_valid = await this.verify_password(input.password, user.password_hash);
      if (!password_valid) {
        return { success: false, error: 'Invalid email or password' };
      }

      const user_id = user._id!.toString();
      
      // Update last login time
      await db.collection(COLLECTIONS.users).updateOne(
        { _id: user._id },
        { 
          $set: { 
            last_login_at: new Date(),
            updated_at: new Date()
          }
        }
      );

      // Generate token
      const token = this.generate_token(user_id);

      return {
        success: true,
        userId: user_id,
        token,
        user: {
          id: user_id,
          email: user.email,
          username: user.username,
          isAdmin: user.is_admin
        }
      };
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: 'Login failed' };
    }
  },

  /**
   * Get user by ID
   */
  async get_user_by_id(user_id: string): Promise<AuthUser | null> {
    const db = get_database();
    
    try {
      const user = await db.collection(COLLECTIONS.users).findOne({
        _id: new ObjectId(user_id)
      }) as User | null;

      if (!user) return null;

      return {
        id: user._id!.toString(),
        email: user.email,
        username: user.username,
        isAdmin: user.is_admin
      };
    } catch (error) {
      console.error('Get user error:', error);
      return null;
    }
  },

  /**
   * Initialize wallet and starting balance for new user
   */
  async initialize_user_wallet(user_id: string): Promise<void> {
    const db = get_database();
    const now = new Date();

    try {
      // Create internal wallet
      const wallet_insert = await db.collection(COLLECTIONS.wallets).insertOne({
        user_id: new ObjectId(user_id),
        address: `internal_wallet_${user_id}`, // Internal wallet identifier
        chain: 'polygon',
        is_primary: true,
        created_at: now,
        last_used_at: now
      });

      // Create starting balance (1000 USDC for demo/testing)
      await db.collection(COLLECTIONS.user_balances).insertOne({
        user_id: new ObjectId(user_id),
        currency: 'USDC',
        available_balance: 1000.00,
        locked_balance: 0.00,
        total_balance: 1000.00,
        updated_at: now
      });

      console.log(`✅ Initialized wallet and balance for user ${user_id}`);
    } catch (error) {
      console.error('Error initializing user wallet:', error);
      throw error;
    }
  }
};