'use client';

import React, { useEffect, useState } from 'react';
import { getApiBase } from '../lib/api';

type AppUser = {
  id: number;
  username: string;
  role: string;
};

const API = getApiBase();

export default function UsersAdminCard() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'editor'>('editor');
  const [editMsg, setEditMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadUsers() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${API}/codes/auth/users`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as AppUser[];
        setUsers(data || []);
      } catch {
        setError('No se pudieron cargar los usuarios.');
      } finally {
        setLoading(false);
      }
    }
    loadUsers();
  }, []);

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault();
    setEditMsg(null);

    if (!editUserId) {
      setEditMsg('Selecciona un usuario primero.');
      return;
    }
    if (!editPassword.trim()) {
      setEditMsg('Escribe una nueva contraseña.');
      return;
    }

    const user = users.find((u) => u.id === editUserId);
    if (!user) {
      setEditMsg('Usuario no encontrado.');
      return;
    }

    try {
      const res = await fetch(`${API}/codes/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          password: editPassword.trim(),
          role: editRole,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.username) {
        setEditMsg(data?.message || 'No se pudo actualizar el usuario.');
        return;
      }

      setEditMsg(`Contraseña actualizada para "${data.username}".`);

      // Actualizar rol en la lista
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editUserId ? { ...u, role: editRole } : u
        )
      );

      setEditPassword('');
    } catch {
      setEditMsg('Error al actualizar el usuario.');
    }
  }

  return (
    <section className="admin-card">
      <h2 className="admin-list-title">Usuarios (admin)</h2>
      <p className="admin-note">
        Desde aquí puedes ver los usuarios registrados y cambiarles la
        contraseña o el rol.
      </p>

      {loading && <p className="admin-status">Cargando usuarios…</p>}
      {error && <p className="admin-status admin-status-error">{error}</p>}

      {/* Lista de usuarios */}
      {users.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              fontSize: 13,
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Usuario</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Rol</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{
                    background:
                      editUserId === u.id ? 'rgba(214,255,79,0.1)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px 4px' }}>{u.username}</td>
                  <td style={{ padding: '6px 4px', textTransform: 'capitalize' }}>
                    {u.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Formulario para cambiar contraseña */}
      <div style={{ marginTop: 16 }}>
        <h3
          className="admin-label"
          style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 8 }}
        >
          Cambiar contraseña / rol
        </h3>

        <form
          onSubmit={handleUpdateUser}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <select
            value={editUserId ?? ''}
            onChange={(e) =>
              setEditUserId(e.target.value ? Number(e.target.value) : null)
            }
            className="admin-select admin-input-pill"
            style={{ minWidth: 160 }}
          >
            <option value="">Selecciona usuario…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>

          <input
            type="password"
            placeholder="Nueva contraseña"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
            className="admin-input admin-input-pill"
            style={{ minWidth: 160 }}
          />

          <select
            value={editRole}
            onChange={(e) =>
              setEditRole(e.target.value === 'admin' ? 'admin' : 'editor')
            }
            className="admin-select admin-input-pill"
            style={{ minWidth: 120 }}
          >
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>

          <button
            type="submit"
            className="admin-btn"
            style={{ background: '#d6ff4f' }}
          >
            Guardar cambios
          </button>
        </form>

        {editMsg && (
          <p
            className={
              editMsg.includes('Error') || editMsg.includes('No se pudo')
                ? 'admin-status admin-status-error'
                : 'admin-status admin-status-ok'
            }
            style={{ marginTop: 8 }}
          >
            {editMsg}
          </p>
        )}
      </div>
    </section>
  );
}
