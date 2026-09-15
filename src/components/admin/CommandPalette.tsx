"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ClipboardList, LayoutDashboard, Layers, Mail, Send, ShieldCheck, Settings } from "lucide-react";
import { listRegistrationForms, type RegistrationFormSummary } from "@/lib/forms";
import { listEvents, type EventRecord } from "@/lib/events";

const PAGES = [
  { label: "Tổng quan", href: "/admin", icon: LayoutDashboard },
  { label: "Sự kiện", href: "/admin/events", icon: Layers },
  { label: "Quản lý form", href: "/admin/forms", icon: ClipboardList },
  { label: "Template thư", href: "/admin/templates", icon: Mail },
  { label: "Chiến dịch email", href: "/admin/campaigns", icon: Send },
  { label: "Phân quyền", href: "/admin/permissions", icon: ShieldCheck },
  { label: "Cài đặt", href: "/admin/settings", icon: Settings },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const router = useRouter();
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    Promise.all([listRegistrationForms(), listEvents()]).then(([formList, eventList]) => {
      if (!active) return;
      setForms(formList);
      setEvents(eventList);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [open, loaded]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Tìm kiếm"
      overlayClassName="fixed inset-0 z-[89] bg-sky-900/40 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12%] z-[90] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-2xl"
    >
      <Command.Input
        autoFocus
        placeholder="Tìm trang, form, sự kiện…"
        className="w-full border-b border-slate-100 px-4 py-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
      />
      <Command.List className="max-h-[60vh] overflow-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">Không tìm thấy.</Command.Empty>

        <Command.Group
          heading="Trang"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-slate-400"
        >
          {PAGES.map((page) => (
            <Command.Item
              key={page.href}
              value={`${page.label} ${page.href}`}
              onSelect={() => go(page.href)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 aria-selected:bg-sky-50 aria-selected:text-sky-800"
            >
              <page.icon size={15} className="text-sky-500" />
              {page.label}
            </Command.Item>
          ))}
        </Command.Group>

        {forms.length > 0 && (
          <Command.Group
            heading="Form"
            className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-slate-400"
          >
            {forms.map((form) => (
              <Command.Item
                key={form.id}
                value={`form ${form.title} ${form.id}`}
                onSelect={() => go(`/admin/forms/${form.id}`)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 aria-selected:bg-sky-50 aria-selected:text-sky-800"
              >
                <ClipboardList size={15} className="text-sky-500" />
                <span className="truncate">{form.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">{form.responseCount} đăng ký</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {events.length > 0 && (
          <Command.Group
            heading="Sự kiện"
            className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-slate-400"
          >
            {events.map((event) => (
              <Command.Item
                key={event.id}
                value={`event ${event.name}`}
                onSelect={() => go("/admin/events")}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 aria-selected:bg-sky-50 aria-selected:text-sky-800"
              >
                <Layers size={15} className="text-indigo-500" />
                <span className="truncate">{event.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
