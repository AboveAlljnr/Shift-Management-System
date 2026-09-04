'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalClose,
} from '@/components/ui/modal';
import {
  createEmployee,
  deactivateEmployee,
  fetchBranches,
  fetchDepartments,
  fetchEmployees,
  fetchEmploymentTypes,
  fetchPositions,
} from '@/lib/api/queries';
import { getInitials } from '@/lib/utils';

type NewEmployee = {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentTypeId: string;
  branchId: string;
  departmentId: string;
  primaryPositionId: string;
  hireDate: string;
};

const emptyForm: NewEmployee = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  employmentTypeId: '',
  branchId: '',
  departmentId: '',
  primaryPositionId: '',
  hireDate: new Date().toISOString().slice(0, 10),
};

export default function WorkforcePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewEmployee>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', search],
    queryFn: () => fetchEmployees(search ? { search } : { limit: 100 }),
    staleTime: 30 * 1000,
  });

  const { data: employmentTypes } = useQuery({ queryKey: ['employment-types'], queryFn: fetchEmploymentTypes });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });

  const total = employees?.pagination.total ?? 0;
  const activeCount = useMemo(
    () => (employees?.data ?? []).filter((e) => e.status === 'active').length,
    [employees],
  );

  const create = useMutation({
    mutationFn: () =>
      createEmployee({
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        employmentTypeId: form.employmentTypeId,
        branchId: form.branchId || undefined,
        departmentId: form.departmentId || undefined,
        primaryPositionId: form.primaryPositionId || undefined,
        hireDate: new Date(form.hireDate + 'T00:00:00.000Z').toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setShowCreate(false);
      setForm(emptyForm);
      setFormError(null);
    },
    onError: (e) => {
      setFormError(e instanceof Error ? e.message : 'Unable to create employee');
    },
  });

  const deactivate = useMutation({
    mutationFn: deactivateEmployee,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.employeeNumber.trim()) return setFormError('Employee number is required');
    if (!form.firstName.trim() || !form.lastName.trim()) return setFormError('Name fields are required');
    if (!form.email.trim()) return setFormError('Email is required');
    if (!form.employmentTypeId) return setFormError('Employment type is required');
    if (!form.hireDate) return setFormError('Hire date is required');
    create.mutate();
  }

  const list = employees?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Workforce"
          subtitle={`${total} people · ${activeCount} active`}
        />
        <Button onClick={() => setShowCreate(true)}>
          Add employee
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or employee number…"
          className="w-full max-w-sm px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-8 w-8 text-slate-400" />
            <p className="font-medium">No employees yet</p>
            <p className="text-sm text-slate-500">Add your first employee to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {list.map((emp) => (
                <li key={emp.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar initials={getInitials(`${emp.firstName} ${emp.lastName}`)} size="md" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {emp.email} · {emp.employeeNumber}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="hidden text-sm text-slate-500 md:inline">
                      {[emp.branch?.name, emp.department?.name].filter(Boolean).join(' · ') || 'Unassigned'}
                    </span>
                    <StatusBadge status={emp.status} />
                    {emp.status !== 'inactive' && (
                      <button
                        onClick={() => deactivate.mutate(emp.id)}
                        disabled={deactivate.isPending}
                        className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-60"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Add employee modal */}
      <Modal open={showCreate} onOpenChange={setShowCreate}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add employee</ModalTitle>
            <ModalDescription>Create a new employee profile</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee number" required>
                <input
                  value={form.employeeNumber}
                  onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
                  placeholder="EMP-002"
                  className={inputClass}
                />
              </Field>
              <Field label="Hire date" required>
                <input
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="First name" required>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Last name" required>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Employment type" required>
                <select
                  value={form.employmentTypeId}
                  onChange={(e) => setForm({ ...form, employmentTypeId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {(employmentTypes ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Branch">
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Primary position">
                <select
                  value={form.primaryPositionId}
                  onChange={(e) => setForm({ ...form, primaryPositionId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(positions ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <ModalFooter className="pt-2">
              <ModalClose asChild>
                <Button variant="secondary">Cancel</Button>
              </ModalClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Saving…' : 'Save employee'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}