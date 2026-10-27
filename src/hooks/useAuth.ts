import { useState, useEffect, useCallback } from 'react';
import pb from '@/lib/pocketbase';

export interface AuthUser {
  id: string;
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (pb.authStore.isValid && pb.authStore.model) {
      setUser({
        id: pb.authStore.model.id,
        email: pb.authStore.model.email,
      });
    }
    setLoading(false);

    const unsubscribe = pb.authStore.onChange(() => {
      if (pb.authStore.isValid && pb.authStore.model) {
        setUser({ id: pb.authStore.model.id, email: pb.authStore.model.email });
      } else {
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await pb.collection('users').authWithPassword(email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
    });
    await pb.collection('users').authWithPassword(email, password);
  }, []);

  const signOut = useCallback(() => {
    pb.authStore.clear();
    setUser(null);
  }, []);

  return { user, loading, signIn, signUp, signOut };
}
