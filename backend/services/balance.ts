import { ObjectId } from 'mongodb';
import { get_database, get_client } from '../database/connection.js';
import { COLLECTIONS, UserBalance, Wallet, LedgerEntry } from '../database/schemas.js';

export interface BalanceInfo {
  currency: string;
  available: number;
  locked: number;
  total: number;
}

export interface WalletInfo {
  id: string;
  address: string;
  type: string;
  balances: BalanceInfo[];
}

export interface BalanceResult {
  success: boolean;
  error?: string;
}

/**
 * Helper to create a ledger entry for audit trail
 */
async function create_ledger_entry(
  user_id: string,
  entry_type: LedgerEntry['entry_type'],
  amount: number,
  currency: string,
  balance_after: number,
  reference_type?: LedgerEntry['reference_type'],
  reference_id?: string,
  description?: string
): Promise<void> {
  const db = get_database();
  const entry: Omit<LedgerEntry, '_id'> = {
    user_id: new ObjectId(user_id),
    entry_type,
    amount,
    currency: currency as 'USDC',
    reference_type,
    reference_id: reference_id ? new ObjectId(reference_id) : undefined,
    description: description || `${entry_type} of ${amount} ${currency}`,
    balance_after,
    created_at: new Date()
  };

  try {
    await db.collection(COLLECTIONS.ledger_entries).insertOne(entry);
  } catch (error) {
    console.error('Failed to write ledger entry:', error);
    // Don't throw - ledger is for audit, shouldn't block main operation
  }
}

export const balance_service = {
  /**
   * Get user's wallet with current balances
   */
  async get_user_wallet(user_id: string): Promise<WalletInfo | null> {
    const db = get_database();
    
    try {
      // Find primary wallet
      const wallet = await db.collection(COLLECTIONS.wallets).findOne({
        user_id: new ObjectId(user_id),
        is_primary: true
      }) as Wallet | null;

      if (!wallet) {
        console.warn(`No primary wallet found for user ${user_id}`);
        return null;
      }

      // Get all balances for this user
      const balances = await db.collection(COLLECTIONS.user_balances)
        .find({ user_id: new ObjectId(user_id) })
        .toArray() as UserBalance[];

      return {
        id: wallet._id!.toString(),
        address: wallet.address,
        type: wallet.chain || 'internal',
        balances: balances.map(b => ({
          currency: b.currency,
          available: b.available_balance,
          locked: b.locked_balance,
          total: b.total_balance
        }))
      };
    } catch (error) {
      console.error('Error getting user wallet:', error);
      return null;
    }
  },

  /**
   * Get available balance for a specific currency
   */
  async get_available_balance(user_id: string, currency: string = 'USDC'): Promise<number> {
    const db = get_database();
    
    try {
      const balance = await db.collection(COLLECTIONS.user_balances).findOne({
        user_id: new ObjectId(user_id),
        currency
      }) as UserBalance | null;

      return balance ? balance.available_balance : 0;
    } catch (error) {
      console.error('Error getting available balance:', error);
      return 0;
    }
  },

  /**
   * Lock funds for an order (move from available to locked)
   */
  async lock_funds(
    user_id: string,
    amount: number,
    currency: string = 'USDC',
    reference_id?: string
  ): Promise<BalanceResult> {
    const db = get_database();
    
    try {
      // Validate amount
      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      // Get current balance
      const balance = await db.collection(COLLECTIONS.user_balances).findOne({
        user_id: new ObjectId(user_id),
        currency
      }) as UserBalance | null;

      if (!balance) {
        return { success: false, error: `No ${currency} balance found` };
      }

      // Check available funds
      if (balance.available_balance < amount) {
        return { 
          success: false, 
          error: `Insufficient funds. Available: ${balance.available_balance}, Required: ${amount}` 
        };
      }

      // Calculate new balances
      const new_available = balance.available_balance - amount;
      const new_locked = balance.locked_balance + amount;

      // Update balance atomically
      const update_result = await db.collection(COLLECTIONS.user_balances).updateOne(
        { 
          _id: balance._id,
          // Ensure balance hasn't changed since we read it
          available_balance: balance.available_balance
        },
        {
          $set: {
            available_balance: new_available,
            locked_balance: new_locked,
            updated_at: new Date()
          }
        }
      );

      if (update_result.matchedCount === 0) {
        return { success: false, error: 'Balance changed during operation. Please try again.' };
      }

      // Write ledger entry for audit trail
      await create_ledger_entry(
        user_id,
        'trade',
        -amount,
        currency,
        new_available,
        'order',
        reference_id,
        `Locked funds for order${reference_id ? ` ${reference_id}` : ''}`
      );

      console.log(`✅ Locked $${amount} ${currency} for user ${user_id}${reference_id ? ` (ref: ${reference_id})` : ''}`);
      return { success: true };

    } catch (error: any) {
      console.error('Error locking funds:', error);
      return { success: false, error: 'Failed to lock funds' };
    }
  },

  /**
   * Unlock funds (move from locked back to available)
   */
  async unlock_funds(
    user_id: string,
    amount: number,
    currency: string = 'USDC',
    reference_id?: string
  ): Promise<BalanceResult> {
    const db = get_database();
    
    try {
      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      // Get current balance
      const balance = await db.collection(COLLECTIONS.user_balances).findOne({
        user_id: new ObjectId(user_id),
        currency
      }) as UserBalance | null;

      if (!balance) {
        return { success: false, error: `No ${currency} balance found` };
      }

      // Check locked funds
      if (balance.locked_balance < amount) {
        return { 
          success: false, 
          error: `Insufficient locked funds. Locked: ${balance.locked_balance}, Required: ${amount}` 
        };
      }

      // Calculate new balances
      const new_available = balance.available_balance + amount;
      const new_locked = balance.locked_balance - amount;

      // Update balance atomically
      const update_result = await db.collection(COLLECTIONS.user_balances).updateOne(
        { 
          _id: balance._id,
          locked_balance: balance.locked_balance // Ensure locked balance hasn't changed
        },
        {
          $set: {
            available_balance: new_available,
            locked_balance: new_locked,
            updated_at: new Date()
          }
        }
      );

      if (update_result.matchedCount === 0) {
        return { success: false, error: 'Balance changed during operation. Please try again.' };
      }

      // Write ledger entry for audit trail
      await create_ledger_entry(
        user_id,
        'trade',
        amount,
        currency,
        new_available,
        'order',
        reference_id,
        `Unlocked funds from cancelled order${reference_id ? ` ${reference_id}` : ''}`
      );

      console.log(`✅ Unlocked $${amount} ${currency} for user ${user_id}${reference_id ? ` (ref: ${reference_id})` : ''}`);
      return { success: true };

    } catch (error: any) {
      console.error('Error unlocking funds:', error);
      return { success: false, error: 'Failed to unlock funds' };
    }
  },

  /**
   * Transfer funds between users (for trade settlement)
   */
  async transfer_funds(
    from_user_id: string,
    to_user_id: string,
    amount: number,
    currency: string = 'USDC',
    reference_id?: string
  ): Promise<BalanceResult> {
    const db = get_database();
    
    try {
      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      // Start a MongoDB session for transaction
      const client = get_client();
      const session = client.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Get sender balance
          const sender_balance = await db.collection(COLLECTIONS.user_balances)
            .findOne({ user_id: new ObjectId(from_user_id), currency }, { session }) as UserBalance | null;

          if (!sender_balance || sender_balance.locked_balance < amount) {
            throw new Error('Insufficient locked funds for transfer');
          }

          // Get receiver balance
          const receiver_balance = await db.collection(COLLECTIONS.user_balances)
            .findOne({ user_id: new ObjectId(to_user_id), currency }, { session }) as UserBalance | null;

          if (!receiver_balance) {
            throw new Error('Receiver balance not found');
          }

          // Update sender: remove from locked
          await db.collection(COLLECTIONS.user_balances).updateOne(
            { _id: sender_balance._id },
            {
              $set: {
                locked_balance: sender_balance.locked_balance - amount,
                total_balance: sender_balance.total_balance - amount,
                updated_at: new Date()
              }
            },
            { session }
          );

          // Update receiver: add to available
          await db.collection(COLLECTIONS.user_balances).updateOne(
            { _id: receiver_balance._id },
            {
              $set: {
                available_balance: receiver_balance.available_balance + amount,
                total_balance: receiver_balance.total_balance + amount,
                updated_at: new Date()
              }
            },
            { session }
          );

          // Write ledger entries inside transaction for consistency
          const sender_ledger: Omit<LedgerEntry, '_id'> = {
            user_id: new ObjectId(from_user_id),
            entry_type: 'trade',
            amount: -amount,
            currency: currency as 'USDC',
            reference_type: 'trade',
            reference_id: reference_id ? new ObjectId(reference_id) : undefined,
            description: `Trade settlement payout${reference_id ? ` for trade ${reference_id}` : ''}`,
            balance_after: sender_balance.locked_balance - amount,
            created_at: new Date()
          };

          const receiver_ledger: Omit<LedgerEntry, '_id'> = {
            user_id: new ObjectId(to_user_id),
            entry_type: 'trade',
            amount,
            currency: currency as 'USDC',
            reference_type: 'trade',
            reference_id: reference_id ? new ObjectId(reference_id) : undefined,
            description: `Trade settlement receipt${reference_id ? ` for trade ${reference_id}` : ''}`,
            balance_after: receiver_balance.available_balance + amount,
            created_at: new Date()
          };

          await db.collection(COLLECTIONS.ledger_entries).insertOne(sender_ledger, { session });
          await db.collection(COLLECTIONS.ledger_entries).insertOne(receiver_ledger, { session });
        });

        console.log(`✅ Transferred $${amount} ${currency} from ${from_user_id} to ${to_user_id}${reference_id ? ` (ref: ${reference_id})` : ''}`);
        return { success: true };

      } finally {
        await session.endSession();
      }

    } catch (error: any) {
      console.error('Error transferring funds:', error);
      return { success: false, error: error.message || 'Failed to transfer funds' };
    }
  },

  /**
   * Get balance history for audit/display
   */
  async get_balance_summary(user_id: string): Promise<{
    balances: BalanceInfo[];
    totalValue: number;
  }> {
    const db = get_database();
    
    try {
      const balances = await db.collection(COLLECTIONS.user_balances)
        .find({ user_id: new ObjectId(user_id) })
        .toArray() as UserBalance[];

      const balance_info = balances.map(b => ({
        currency: b.currency,
        available: b.available_balance,
        locked: b.locked_balance,
        total: b.total_balance
      }));

      // Calculate total value in USD (for now, just USDC)
      const total_value = balance_info.reduce((sum, b) => {
        if (b.currency === 'USDC') return sum + b.total;
        return sum; // Add other currency conversions here
      }, 0);

      return {
        balances: balance_info,
        totalValue: total_value
      };
    } catch (error) {
      console.error('Error getting balance summary:', error);
      return { balances: [], totalValue: 0 };
    }
  }
};