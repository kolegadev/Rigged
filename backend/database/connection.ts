import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let database: Db | null = null;

export const connect_to_mongodb = async (): Promise<Db> => {
  if (database) {
    return database;
  }

  const mongodb_uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const database_name = process.env.DATABASE_NAME || 'app_database';

  try {
    client = new MongoClient(mongodb_uri);
    await client.connect();
    database = client.db(database_name);
    return database;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};

export const get_database = (): Db & { client: MongoClient } => {
  if (!database || !client) {
    throw new Error('Database not connected. Call connect_to_mongodb first.');
  }
  return Object.assign(database, { client });
};

export const get_client = (): MongoClient => {
  if (!client) {
    throw new Error('Client not connected. Call connect_to_mongodb first.');
  }
  return client;
};

export const close_connection = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}; 