'use client';

import React, { useEffect, useState } from 'react';
import { getApiBase } from '../../lib/api';

type CodeItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;   // Usuario asignado a código
  encargado_anterior?: string | null; // Sub usuario
  comentario?: string | null;         // Comentario
};

type AuthUser = {
  id: number;
  username: string;
  role: string; // 'admin' | 'editor'
};

type AdminPanelProps = {
  currentUser: AuthUser;
};

type ColabRole = 'admin' | 'editor';

const API = getApiBase();
const ACCENT = '#d6ff4f';

export default function AdminPanel({ currentUser }: AdminPanelProps) {
  const isAdmin: boolean = currentUser.role === 'admin';

  // -----------------------
  // STATE PRINCIPAL (CÓDIGOS)
  // -----------------------
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // actualización masiva
  const [bulkInput, setBulkInput] = useState('');
  const [bulkResults, setBulkResults] = useState<CodeItem[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkGrupo, setBulkGrupo] = useState('');
  const [bulkEncargado, setBulkEncargado] = useState('');
  const [bulkSubEncargado, setBulkSubEncargado] = useState('');
  const [bulkComentario, setBulkComentario] = useState('');

  // herramientas rápidas
  const [newGroupName, setNewGroupName] = useState('');
  const [newEncargadoName, setNewEncargadoName] = useState('');
  const [newSubEncargadoName, setNewSubEncargadoName] = useState('');
  const [createdGroups, setCreatedGroups] = useState<string[]>([]);
  const [createdEncargados, setCreatedEncargados] = useState<string[]>([]);

  // gestión de Colaboradores (solo admin)
  const [newColabName, setNewColabName] = useState('');
  const [newColabPass, setNewColabPass] = useState('');
  const [newColabRole, setNewColabRole] = useState<ColabRole>('editor');
  const [colabMsg, setColabMsg] = useState<string | null>(null);
  const [colabError, setColabError] = useState<string | null>(null);

  // catálogos
  const [catalogGroups, setCatalogGroups] = useState<any[]>([]);
  const [catalogEncargados, setCatalogEncargados] = useState<any[]>([]);
  const [catalogSubEncargados, setCatalogSubEncargados] = useState<any[]>([]);

  // -----------------------
  // HERRAMIENTAS RÁPIDAS (GRUPOS / ENCARGADOS)
  // -----------------------

  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;

    try {
      const res = await fetch(`${API}/codes/tools/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCreatedGroups((prev) => [data.name, ...prev.slice(0, 4)]);
      setCatalogGroups((prev) => [{ id: data.id, name: data.name }, ...prev]);
      setNewGroupName('');
    } catch (err) {
      console.error(err);
    }
  }

  async function addEncargado() {
    const nombre = newEncargadoName.trim();
    if (!nombre) return;

    try {
      const res = await fetch(`${API}/codes/tools/encargado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCreatedEncargados((prev) => [data.nombre, ...prev.slice(0, 4)]);
      setCatalogEncargados((prev) => [
        { id: data.id, nombre: data.nombre },
        ...prev,
      ]);
      setNewEncargadoName('');
    } catch (err) {
      console.error(err);
    }
  }

  async function addSubEncargado() {
    const nombre = newSubEncargadoName.trim();
    if (!nombre) return;

    try {
      const res = await fetch(`${API}/codes/tools/sub-encargado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCatalogSubEncargados((prev) => [
        { id: data.id, nombre: data.nombre },
        ...prev,
      ]);
      setNewSubEncargadoName('');
    } catch (err) {
      console.error(err);
    }
  }

  // -----------------------
  // GESTIÓN DE COLABORADORES (SOLO ADMIN)
  // -----------------------

  async function handleCreateColaborador(e: React.FormEvent) {
    e.preventDefault();
    setColabMsg(null);
    setColabError(null);

    const u = newColabName.trim();
    const p = newColabPass.trim();

    if (!u || !p) {
      setColabError('Colaborador y contraseña son obligatorios.');
      return;
    }

    try {
      const res = await fetch(`${API}/codes/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: u,
          password: p,
          role: newColabRole,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data || !data.username) {
        setColabError(
          data?.message || 'No se pudo crear/actualizar el colaborador.',
        );
        return;
      }

      setColabMsg(
        `Colaborador "${data.username}" creado/actualizado como rol ${data.role}.`,
      );
      setNewColabName('');
      setNewColabPass('');
    } catch (err) {
      console.error(err);
      setColabError('Error al crear colaborador.');
    }
  }

  // -----------------------
  // BUSCAR INDIVIDUAL (CÓDIGOS)
  // -----------------------

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError('Escribe algo para buscar.');
      return;
    }

    const looksLikeCode =
      /^\d+$/.test(trimmed) || trimmed.toUpperCase().startsWith('PL');

    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      let items: CodeItem[] = [];

      if (looksLikeCode) {
        const res = await fetch(
          `${API}/codes/by-code?code=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        if (data) items = [data as CodeItem];
      } else {
        const res = await fetch(
          `${API}/codes?query=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        items = (Array.isArray(data) ? data : data.items || []) as CodeItem[];
      }

      setResults(items);
      if (!items.length) {
        setError(`No se encontraron resultados para "${trimmed}".`);
      }
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error al buscar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  // UPDATE LOCAL / GUARDAR ITEM
  // -----------------------

  function updateLocalField(id: number, field: keyof CodeItem, value: any) {
    setResults((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  }

  async function saveItem(item: CodeItem) {
    try {
      setSavingId(item.id);
      setMessage(null);
      setError(null);

      const body = {
        encargado_actual: item.encargado_actual ?? null,
        encargado_anterior: item.encargado_anterior ?? null,
        comentario: item.comentario ?? null,
        grupo_id:
          item.grupo_id !== undefined && item.grupo_id !== null
            ? Number(item.grupo_id)
            : null,
        razon_social: item.razon_social ?? null,
        direccion: item.direccion ?? null,
        municipio: item.municipio ?? null,
        estado: item.estado ?? null,
      };

      const res = await fetch(`${API}/codes/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = (await res.json()) as CodeItem;

      setResults((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r)),
      );
      setMessage(`Cambios guardados para ${updated.code}.`);
    } catch (err) {
      console.error(err);
      setError('No se pudieron guardar los cambios.');
    } finally {
      setSavingId(null);
    }
  }

  // -----------------------
  // BÚSQUEDA MASIVA (CÓDIGOS)
  // -----------------------

  async function bulkLookup(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (!lines.length) {
      setBulkResults([]);
      setResults([]);
      setBulkError('Pega al menos un código.');
      return;
    }

    try {
      setBulkError(null);
      setBulkMessage(null);
      setBulkSaving(true);

      const res = await fetch(`${API}/codes/bulk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: lines }),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as CodeItem[];

      setBulkResults(data);
      setResults(data);

      if (!data.length) {
        setBulkError('Ninguno de los códigos pegados fue encontrado.');
      }
    } catch (err) {
      console.error(err);
      setBulkError('Error al buscar la lista. Intenta de nuevo.');
      setResults([]);
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkApply() {
    if (!bulkResults.length) {
      setBulkError('Primero busca la lista.');
      return;
    }

    if (
      !bulkGrupo &&
      !bulkEncargado &&
      !bulkSubEncargado &&
      !bulkComentario.trim()
    ) {
      setBulkError('Ingresa Grupo, Usuario, Sub usuario o Comentario.');
      return;
    }

    try {
      setBulkSaving(true);
      setBulkError(null);
      setBulkMessage(null);

      const ids = bulkResults.map((r) => r.id);

      const body = {
        ids,
        encargado_actual: bulkEncargado || null,
        grupo_id: bulkGrupo ? Number(bulkGrupo) : null,
        encargado_anterior: bulkSubEncargado || null,
        comentario: bulkComentario.trim() || null,
      };

      const res = await fetch(`${API}/codes/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Error al aplicar cambios');

      const data = (await res.json()) as {
        updated: CodeItem[];
        skipped: {
          id: number;
          code: string;
          encargado_actual: string | null;
        }[];
      };

      const updated = data.updated || [];
      const skipped = data.skipped || [];

      const updatedMap = new Map(updated.map((u) => [u.id, u]));

      setResults((prev) => prev.map((p) => updatedMap.get(p.id) ?? p));
      setBulkResults(updated);

      if (updated.length) {
        setBulkMessage(`Cambios aplicados a ${updated.length} código(s).`);
      } else {
        setBulkMessage(null);
      }

      if (skipped.length) {
        const detalle = skipped
          .map(
            (s) =>
              `${s.code} (usuario actual: ${
                s.encargado_actual && s.encargado_actual.trim() !== ''
                  ? s.encargado_actual
                  : '—'
              })`,
          )
          .join(', ');

        setBulkError(
          `Los siguientes códigos no se actualizaron porque ya tienen usuario asignado: ${detalle}`,
        );
      }
    } catch (err) {
      console.error(err);
      setBulkError('No se pudieron aplicar cambios.');
    } finally {
      setBulkSaving(false);
    }
  }

  // -----------------------
  // CARGAR CATÁLOGOS
  // -----------------------

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/codes/tools/catalogs`);
        if (res.ok) {
          const data = await res.json();
          setCatalogGroups(data.groups || []);
          setCatalogEncargados(data.encargados || []);
          setCatalogSubEncargados(data.subEncargados || []);
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  // -----------------------
  // UI
  // -----------------------

  return (
    <>
      {/* HEADER */}
      <header className="admin-header">
        <div className="admin-header-left">
          <div className="admin-tag">COSMOSX</div>
          <h1 className="admin-title">Panel de administración</h1>
          <p className="admin-subtitle">
            Busca un código o edita datos.
          </p>
        </div>
        <a href="/" className="admin-link-back">
          ← Volver
        </a>
      </header>

      {/* GESTIÓN DE COLABORADORES (solo admins) */}
      {isAdmin && (
        <section className="admin-card">
          <h2 className="admin-list-title">Colaboradores</h2>
          <p className="admin-note">
            Aquí puedes crear Colaboradores que tendrán acceso al buscador
            y al panel. Solo los Colaboradores Administradores pueden usar 
            esta sección.
          </p>

          <form
            onSubmit={handleCreateColaborador}
            style={{
              marginTop: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <input
              className="admin-input admin-input-pill"
              style={{ minWidth: 140, flex: '1 1 140px' }}
              placeholder="Colaborador (usuario)"
              value={newColabName}
              onChange={(e) => setNewColabName(e.target.value)}
            />
            <input
              className="admin-input admin-input-pill"
              style={{ minWidth: 140, flex: '1 1 140px' }}
              type="password"
              placeholder="Contraseña"
              value={newColabPass}
              onChange={(e) => setNewColabPass(e.target.value)}
            />
            <select
              className="admin-select admin-input-pill"
              style={{ minWidth: 120 }}
              value={newColabRole}
              onChange={(e) =>
                setNewColabRole(
                  e.target.value === 'admin' ? 'admin' : 'editor',
                )
              }
            >
              <option value="editor">Editor</option>
              <option value="admin">Administrador</option>
            </select>

            <button
              type="submit"
              className="admin-btn"
              style={{ background: ACCENT }}
            >
              Guardar colaborador
            </button>
          </form>

          {colabMsg && (
            <p
              className="admin-status admin-status-ok"
              style={{ marginTop: 8 }}
            >
              {colabMsg}
            </p>
          )}
          {colabError && (
            <p
              className="admin-status admin-status-error"
              style={{ marginTop: 8 }}
            >
              {colabError}
            </p>
          )}
        </section>
      )}

      {/* A PARTIR DE AQUÍ va TODO tu bloque de HERRAMIENTAS RÁPIDAS, BÚSQUEDA, RESULTADOS, etc.
          Puedes conservar exactamente el JSX que ya tenías antes para:
          - Crear grupos
          - Crear encargados
          - Búsqueda individual
          - Búsqueda masiva
          - Render de tarjetas de códigos
      */}
    </>
  );
}
