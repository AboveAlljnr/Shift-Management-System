'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Check, Clock } from 'lucide-react';
import { useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/queries';
import type { Notification } from '@sms/shared';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, parseISO } from 'date-fns';

const EVENT_LABELS: Record<string, string> = {
  'schedule.published': 'Schedule published',
  'shift.assigned': 'Shift assigned',
  'open_shift.available': 'Open shift available',
  'open_shift.requested': 'Open shift requested',
  'open_shift.approved': 'Open shift approved',
  'open_shift.rejected': 'Open shift declined',
  'swap.requested': 'Swap requested',
  'swap.accepted': 'Swap accepted',
  'swap.rejected': 'Swap declined',
  'swap.approved': 'Swap approved',
  'leave.approved': 'Leave approved',
  'leave.rejected': 'Leave declined',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
    refetchInterval: 30 * 1000,
  });

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: fetchUnreadCount,
    refetchInterval: 30 * 1000,
  });

  const list = useMemo(
    () => (notifications ?? []).filter((n) => n.channel === 'in_app'),
    [notifications],
  );
  const unreadCount = unread?.count ?? list.filter((n) => !n.isRead).length;

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up'}
        />
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending} className="gap-2">
            <CheckCheck size={14} />
            Mark all read
          </Button>
        )}
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
            <Bell className="h-8 w-8 text-slate-400" />
            <p className="font-medium">No notifications yet</p>
            <p className="text-sm text-slate-500">
              Shift updates, open-shift offers, swap replies, and leave decisions will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {list.map((n) => (
                <NotificationRow key={n.id} notification={n} onMarkRead={() => markRead.mutate(n.id)} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  return (
    <li
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-6 py-3',
        !notification.isRead && 'bg-brand/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!notification.isRead && <span className="h-2 w-2 rounded-full bg-brand" />}
          <p className={cn('text-sm text-slate-800', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </p>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {EVENT_LABELS[notification.eventType] ?? notification.eventType.replace(/_/g, ' ')}
          </span>
        </div>
        {notification.body && <p className="mt-0.5 text-xs text-slate-500">{notification.body}</p>}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
          <Clock size={11} />
          {formatDistanceToNow(parseISO(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!notification.isRead && (
        <Button variant="secondary" size="sm" onClick={onMarkRead} className="shrink-0">
          <Check size={14} /> Mark read
        </Button>
      )}
    </li>
  );
}