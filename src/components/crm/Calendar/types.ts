export interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
  color?: string;
  location?: string;
  organization?: { name: string } | null;
  category?: { name: string; color?: string } | null;
  is_meeting?: boolean;
  meeting_data?: any;
  assigned_employees?: { id: string; name: string; surname: string }[];
}

export type EventStatus =
  | 'inquiry'
  | 'offer_to_send'
  | 'offer_sent'
  | 'offer_accepted'
  | 'in_preparation'
  | 'ready_for_live'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'invoiced';

export interface EquipmentBooking {
  id: string;
  equipment_id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  equipment?: {
    name: string;
    category: string;
  };
}

export interface EmployeeAssignment {
  id: string;
  employee_id: string;
  role?: string;
  hours?: number;
  employee?: {
    first_name: string;
    last_name: string;
    position?: string;
  };
}

export interface EventTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to?: string;
  due_date?: string;
}

export type CalendarView = 'month' | 'week' | 'day' | 'employee';

export interface CalendarViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDateClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onEventHover?: (event: CalendarEvent | null, position?: { x: number; y: number }) => void;
}
