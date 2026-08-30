import { useState } from 'react';

const EMPTY = { title: '', description: '', contact: '', due_date: '', priority: 'medium' };

export default function AddTaskForm({ onAdd }) {
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    onAdd({ ...form, title: form.title.trim() });
    setForm(EMPTY);
    setOpen(false);
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="add-row">
        <input
          className="grow"
          value={form.title}
          onChange={set('title')}
          placeholder="Add a task…"
          onFocus={() => setOpen(true)}
        />
        <button className="btn primary" type="submit" disabled={!form.title.trim()}>
          Add
        </button>
      </div>

      {open && (
        <div className="add-details">
          <input value={form.description} onChange={set('description')} placeholder="Notes (optional)" />
          <input value={form.contact} onChange={set('contact')} placeholder="Who / which client" />
          <input type="date" value={form.due_date} onChange={set('due_date')} />
          <select value={form.priority} onChange={set('priority')}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      )}
    </form>
  );
}
