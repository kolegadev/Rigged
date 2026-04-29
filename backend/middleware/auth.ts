import jwt from 'jsonwebtoken';

export const get_user_from_request = async (req: any): Promise<{ id: string } | null> => {
  const auth_header = req.header('Authorization');
  
  if (!auth_header?.startsWith('Bearer ')) {
    return null;
  }

  const token = auth_header.slice(7);
  const jwt_secret = process.env.JWT_TOKEN || 'secret';

  try {
    const decoded = jwt.verify(token, jwt_secret) as any;
    return { id: decoded.userId };
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
};