// src/lib/supabase.ts (put this in its own file):
//   import { createClient } from '@supabase/supabase-js'
//   export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
// Never put the service role key in the frontend.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'

export type Role = 'seller' | 'customer' | 'admin'

type Ctx = {
  session: Session | null
  role: Role | null
  roleChosen: boolean
  loading: boolean
  signInGoogle: () => Promise<void>
  signInEmail: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, role: 'seller' | 'customer', name: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  chooseRole: (role: 'seller' | 'customer') => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
export const useAuth = () => useContext(AuthCtx)

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [roleChosen, setRoleChosen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const client = getSupabaseClient()

      client.auth.getSession().then(({ data }) => {
        setSession(data.session)
        if (!data.session) setLoading(false)
      })

      const { data } = client.auth.onAuthStateChange((_e, s) => {
        setSession(s)
        if (!s) { setRole(null); setLoading(false) }
      })

      return () => data.subscription.unsubscribe()
    } catch (error) {
      setLoading(false)
      return undefined
    }
  }, [])

  const loadProfile = async (uid: string) => {
    const client = getSupabaseClient()
    const { data } = await client.from('profiles').select('role, role_chosen').eq('id', uid).single()
    setRole((data?.role as Role) ?? null)
    setRoleChosen(!!data?.role_chosen)
    setLoading(false)
  }
  useEffect(() => { if (session) loadProfile(session.user.id) }, [session?.user.id])

  const value: Ctx = {
    session, role, roleChosen, loading,
    signInGoogle: async () => {
      const client = getSupabaseClient()
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      fail(error)
    },
    signInEmail: async (email, password) => {
      const client = getSupabaseClient()
      const { error } = await client.auth.signInWithPassword({ email, password })
      fail(error)
    },
    signUp: async (email, password, role, name) => {
      const client = getSupabaseClient()
      const { error } = await client.auth.signUp({
        email, password,
        options: { data: { role, full_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      fail(error) // user must click the emailed link when email confirmation is on
    },
    resetPassword: async (email) => {
      const client = getSupabaseClient()
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` })
      fail(error)
    },
    chooseRole: async (r) => {
      const client = getSupabaseClient()
      const { error } = await client.rpc('choose_role', { r })
      fail(error)
      if (session) await loadProfile(session.user.id)
    },
    signOut: async () => {
      const client = getSupabaseClient()
      await client.auth.signOut()
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

// Usage: <RequireRole allow={['seller','admin']}><Dashboard/></RequireRole>
// This only hides UI. The real protection is the RLS policies in schema.sql.
export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { session, role, roleChosen, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!roleChosen && role !== 'admin') return <Navigate to="/choose-role" replace />
  if (!role || !allow.includes(role)) return <Navigate to="/forbidden" replace />
  return <>{children}</>
}
