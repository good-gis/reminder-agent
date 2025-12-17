// Приоритет задачи
export type Priority = 'low' | 'medium' | 'high' | 'critical';

// Статус задачи
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue';

// Интерфейс задачи
export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  status: TaskStatus;
  dueDate?: string;  // ISO date string
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

// Структура файла tasks.json
export interface TasksData {
  tasks: Task[];
  lastUpdated: string;
}

// Фильтры для получения задач
export interface TaskFilter {
  status?: TaskStatus;
  priority?: Priority;
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
}

// Результат сводки
export interface TaskSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<Priority, number>;
  overdueTasks: Task[];
  upcomingTasks: Task[];  // Задачи на ближайшие 24 часа
  todayTasks: Task[];
}
