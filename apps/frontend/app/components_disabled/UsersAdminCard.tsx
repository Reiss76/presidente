'use client';

import React, { useEffect, useState } from 'react';
import { getApiBase } from '../../lib/api';

const API = getApiBase();

type Colaborador = {
  id: number;
  username: string;
  role: string; // 'admin' | 'editor'
};

export default function UsersAdminCard() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'editor'>('editor');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadColaboradores() {
    try {
      setLoading(true);
      const res = await fetch(`${API}/codes/auth/users`);
      const data = (await res.json()) as Colaborador[];
      setColaboradores(data || []);
    } catch (err) {
      console.error(err);
      setMessage('No se pudieron cargar los colaboradores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadColaboradores();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!selectedId) {
      setMessage('Selecciona un colaborador.');
      return;
    }

    const colab = colaboradores.find((c) => c.id === selectedId);
    if (!colab) {
      setMessage('Colaborador no encontrado.');
      return;
    }

    if (!newPassword.trim()) {
      setMessage('Escribe una nueva contraseña.');
      return;
    }

    try {
      const res = await fetch(`${API}/codes/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: colab.username,
          password: newPassword.trim(),
          role: newRole,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.username) {
        setMessage(data?.message || 'No se pudo actualizar el colaborador.');
        return;
      }

      setMessage(
        `Contraseña actualizada para "${data.username}" (rol: ${data.role}).`,
      );
      setNewPassword('');

      // Actualizar el rol en la lista local
      setColaboradores((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, role: newRole } : c,
        ),
      );
    } catch (err) {
      console.error(err);
      setMessage('Error al guardar cambios.');
    }
  }

  return (
    <section className="admin-card">
      <h2 className="admin-title">Colaboradores del sistema</h2>
      <p className="admin-note">
        Solo los Colaboradores Administradores pueden ver y modificar esta
        sección. Aquí puedes actualizar la contraseña o el rol de otros
        colaboradores.
      </p>

      {loading && <p className="admin-status">Cargando colaboradores…</p>}

      {/* Tabla de colaboradores */}
      {colaboradores.length > 0 && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              fontSize: 13,
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>
                  Colaborador
                </th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>
                  Rol
                </th>
              </tr>
            </thead>
            <tbody>
              {colaboradores.map((c) => (
                <tr
                  key={c.id}
                  style={{
                    background:
                      selectedId === c.id
                        ? 'rgba(214,255,79,0.12)'
                        : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px 4px' }}>{c.username}</td>
                  <td
                    style={{
                      padding: '6px 4px',
                      textTransform: 'capitalize',
                    }}
                  >
                    {c.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Formulario para actualizar contraseña / rol */}
      <div style={{ marginTop: 16 }}>
        <h3
          className="admin-label"
          style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 8 }}
        >
          Actualizar contraseña / rol de un colaborador
        </h3>

        <form
          onSubmit={handleSave}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <select
            className="admin-select admin-input-pill"
            style={{ minWidth: 160 }}
            value={selectedId ?? ''}
            onChange={(e) =>
              setSelectedId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Selecciona colaborador…</option>
            {colaboradores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.username}
              </option>
            ))}
          </select>

          <input
            type="password"
            placeholder="Nueva contraseña"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="admin-input admin-input-pill"
            style={{ minWidth: 180 }}
          />

          <select
            className="admin-select admin-input-pill"
            style={{ minWidth: 120 }}
            value={newRole}
            onChange={(e) =>
              setNewRole(e.target.value === 'admin' ? 'admin' : 'editor')
            }
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

        {message && (
          <p
            className={
              message.includes('Error') || message.includes('No se pudo')
                ? 'admin-status admin-status-error'
                : 'admin-status admin-status-ok'
            }
            style={{ marginTop: 8 }}
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
