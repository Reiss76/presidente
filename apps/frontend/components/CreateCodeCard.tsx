'use client';

import React, { useState } from 'react';
import { getApiBase } from '../lib/api';

const API = getApiBase();
const ACCENT = '#d6ff4f';

export default function CreateCodeCard() {
  const [code, setCode] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [estado, setEstado] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [direccion, setDireccion] = useState('');

  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setOkMsg(null);
    setErrMsg(null);

    const payload = {
      code: code.trim(),
      razon_social: razonSocial.trim(),
      estado: estado.trim(),
      municipio: municipio.trim(),
      direccion: direccion.trim(),
    };

    if (
      !payload.code ||
      !payload.razon_social ||
      !payload.estado ||
      !payload.municipio ||
      !payload.direccion
    ) {
      setErrMsg('Código, Razón Social, Estado, Municipio y Dirección son obligatorios.');
      return;
    }

    try {
      setSaving(true);

      const res = await fetch(`${API}/codes/tools/create-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrMsg(data?.message || 'No se pudo crear el código.');
        return;
      }

      setOkMsg(`✅ Código creado: ${data?.code || payload.code}`);
      setCode('');
      setRazonSocial('');
      setEstado('');
      setMunicipio('');
      setDireccion('');
    } catch (err) {
      console.error(err);
      setErrMsg('Error de red al crear el código.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-card">
      <div className="admin-label" style={{ marginBottom: 6 }}>
        Cargar nuevo código
      </div>
      <p className="admin-note" style={{ marginBottom: 14 }}>
        Crea un registro de código nuevo. Razón Social, Estado, Municipio y Dirección son obligatorios.
      </p>

      <form onSubmit={handleCreate}>
        <div className="createcode-grid">
          {/* Fila 1 */}
          <div className="createcode-field">
            <label className="admin-label">Código</label>
            <input
              className="admin-input-rect"
              placeholder="PL/21069/EXP/ES/2018"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="createcode-field">
            <label className="admin-label">Razón social</label>
            <input
              className="admin-input-rect"
              placeholder="Nombre comercial o razón social"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
            />
          </div>

          {/* Fila 2 */}
          <div className="createcode-field">
            <label className="admin-label">Estado</label>
            <input
              className="admin-input-rect"
              placeholder="Ej. TAMAULIPAS"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            />
          </div>

          <div className="createcode-field">
            <label className="admin-label">Municipio</label>
            <input
              className="admin-input-rect"
              placeholder="Ej. CIUDAD VICTORIA"
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
            />
          </div>

          {/* Dirección full */}
          <div className="createcode-field-full">
            <label className="admin-label">Dirección</label>
            <input
              className="admin-input-rect"
              placeholder="Calle, número, colonia..."
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
            />
          </div>

          <div className="createcode-actions">
            <button
              type="submit"
              className="admin-btn admin-btn-thin"
              style={{ background: ACCENT }}
              disabled={saving}
            >
              {saving ? 'Creando…' : 'Crear código'}
            </button>
          </div>
        </div>
      </form>

      {errMsg && <p className="admin-status admin-status-error">{errMsg}</p>}
      {okMsg && <p className="admin-status admin-status-ok">{okMsg}</p>}
    </section>
  );
}
