// Business directory categories. Keys are stored in businesses.category.
// Kept in sync with the frontend CATEGORY_META (src/lib/mock/businesses.ts).
// Subcategories are suggestions — free text is accepted.
export const BUSINESS_CATEGORIES = {
  beauty: {
    label: 'Beauty & Grooming',
    emoji: '💇',
    subcategories: ['Hair Salon', 'Barbershop', 'Nails', 'Lashes & Brows', 'Massage', 'Spa', 'Tattoo'],
  },
  health: {
    label: 'Health & Wellness',
    emoji: '🩺',
    subcategories: ['Doctor', 'Dentist', 'Therapist', 'Chiropractor', 'Acupuncture', 'Nutritionist'],
  },
  home: {
    label: 'Home Services',
    emoji: '🏠',
    subcategories: ['Cleaning', 'Handyman', 'Plumber', 'Electrician', 'Lawn Care', 'Moving'],
  },
  pet: {
    label: 'Pet Care',
    emoji: '🐾',
    subcategories: ['Grooming', 'Vet', 'Boarding', 'Walking', 'Training'],
  },
  fitness: {
    label: 'Fitness',
    emoji: '💪',
    subcategories: ['Personal Trainer', 'Yoga', 'Pilates', 'Boxing', 'Physio'],
  },
  automotive: {
    label: 'Automotive',
    emoji: '🚗',
    subcategories: ['Auto Repair', 'Detailing', 'Tire Service', 'Oil Change', 'Body Shop'],
  },
  photography: {
    label: 'Photography & Video',
    emoji: '📸',
    subcategories: ['Portrait', 'Event Photography', 'Headshots', 'Wedding', 'Commercial'],
  },
  education: {
    label: 'Education & Tutoring',
    emoji: '📚',
    subcategories: ['Math', 'Science', 'Test Prep', 'Language', 'Music Lessons', 'Coding'],
  },
  events: {
    label: 'Events & Entertainment',
    emoji: '🎉',
    subcategories: ['DJ', 'Catering', 'Event Planning', 'Photo Booth', 'Live Band'],
  },
  dining: {
    label: 'Food & Dining',
    emoji: '🍽️',
    subcategories: ['Restaurant', 'Private Chef', 'Cafe', 'Food Truck', 'Catering'],
  },
  legal: {
    label: 'Legal & Professional',
    emoji: '⚖️',
    subcategories: ['Consultation', 'Contract Review', 'Immigration', 'Family Law', 'Business Law'],
  },
  tech: {
    label: 'Tech Repair & Support',
    emoji: '💻',
    subcategories: ['Phone Repair', 'Computer Repair', 'Data Recovery', 'IT Support', 'Network Setup'],
  },
  wellness: {
    label: 'Wellness & Spa',
    emoji: '🧘',
    subcategories: ['Meditation', 'Acupuncture', 'Sauna', 'Float Therapy', 'Holistic Healing'],
  },
};

export const BUSINESS_CATEGORY_KEYS = Object.keys(BUSINESS_CATEGORIES);

export const PAYMENT_MODELS = ['full', 'deposit', 'in_person'];
export const LOCATION_TYPES = ['physical', 'mobile'];
export const BOOKING_CONFIRMATION_MODES = ['automatic', 'manual'];

// Default weekly hours for a new business (0 = Sunday). Matches onboarding UI.
export const DEFAULT_BUSINESS_HOURS = {
  0: null,
  1: { open: '09:00', close: '18:00' },
  2: { open: '09:00', close: '18:00' },
  3: { open: '09:00', close: '18:00' },
  4: { open: '09:00', close: '18:00' },
  5: { open: '09:00', close: '18:00' },
  6: { open: '10:00', close: '16:00' },
};
