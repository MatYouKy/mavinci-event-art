export interface CalendarEvent {
  id: string;
  name: string;
  client_id: string | null;
  client?: {
    company_name?: string;
    first_name?: string;
    last_name?: string;
  };
  event_date: string;
  event_end_date?: string | null;
  location: string;
  description?: string;
  status: EventStatus;
  budget?: number;
  final_cost?: number;
  notes?: string;
  equipment?: EquipmentBooking[];
  employees?: EmployeeAssignment[];
  tasks?: EventTask[];
  attachments?: string[];
}

export type EventStatus =
  | 'offer_sent'
  | 'offer_accepted'
  | 'in_preparation'
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

export type CalendarView = 'month' | 'week' | 'day';

export interface CalendarViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDateClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onEventHover?: (event: CalendarEvent | null, position?: { x: number; y: number }) => void;
}
