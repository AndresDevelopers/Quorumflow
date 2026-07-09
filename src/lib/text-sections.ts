export interface TextSection {
  id: string;
  label: string;
  description: string;
  category: string;
}

export const textSections: TextSection[] = [
  {
    id: 'personal-info',
    label: 'textSections.personalInfo',
    description: 'Nombre, fecha de nacimiento, foto de perfil',
    category: 'Perfil'
  },
  {
    id: 'contact-info',
    label: 'textSections.contactInfo',
    description: 'Email, teléfono, dirección',
    category: 'Perfil'
  },
  {
    id: 'attendance',
    label: 'textSections.attendance',
    description: 'Asistencia a reuniones y actividades',
    category: 'Actividades'
  },
  {
    id: 'assignments',
    label: 'textSections.assignments',
    description: 'Responsabilidades y asignaciones asignadas',
    category: 'Actividades'
  },
  {
    id: 'reports',
    label: 'textSections.reports',
    description: 'Reportes de visitas y enseñanzas',
    category: 'Reportes'
  },
  {
    id: 'teaching-record',
    label: 'textSections.teachingRecord',
    description: 'Historial de enseñanzas dadas',
    category: 'Reportes'
  },
  {
    id: 'statistics',
    label: 'textSections.statistics',
    description: 'Estadísticas de progreso y rendimiento',
    category: 'Análisis'
  },
  {
    id: 'notifications',
    label: 'textSections.notifications',
    description: 'Alertas y recordatorios',
    category: 'Sistema'
  }
];

export const getTextSectionsByCategory = () => {
  const categories: Record<string, TextSection[]> = {};
  
  textSections.forEach(section => {
    if (!categories[section.category]) {
      categories[section.category] = [];
    }
    categories[section.category].push(section);
  });
  
  return categories;
};
