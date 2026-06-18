import { motion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  Globe,
  Megaphone,
  Newspaper,
  Scale,
  ShoppingCart,
  Smartphone,
  Users,
} from "lucide-react";

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  tags: string[];
  prompt: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "saas-dashboard",
    name: "SaaS Dashboard",
    description:
      "Admin dashboard with charts, user management, settings, and API integration.",
    icon: BarChart3,
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
    tags: ["React", "Charts", "Auth"],
    prompt:
      "Build a SaaS admin dashboard with a sidebar navigation, analytics charts showing revenue and user growth, a user management table with search and pagination, settings page, and dark mode support.",
  },
  {
    id: "campaign-site",
    name: "Activist Campaign Site",
    description:
      "Bold landing page with email signup, donation button, and social sharing.",
    icon: Megaphone,
    color: "text-red-400",
    bgColor: "bg-red-400/10",
    tags: ["Landing", "Email", "Social"],
    prompt:
      "Build an activist campaign website with a bold hero section, mission statement, call-to-action buttons for donations and volunteering, email signup form, social media sharing buttons, and an events calendar.",
  },
  {
    id: "news-platform",
    name: "News Platform",
    description:
      "Article publishing system with categories, comments, and admin panel.",
    icon: Newspaper,
    color: "text-violet-400",
    bgColor: "bg-violet-400/10",
    tags: ["CMS", "Articles", "Admin"],
    prompt:
      "Build a news platform with a homepage showing featured and latest articles, category navigation, individual article pages with comments, author profiles, and an admin publishing dashboard.",
  },
  {
    id: "legal-tool",
    name: "Legal Case Tracker",
    description:
      "Case management with timeline, document uploads, and client portal.",
    icon: Scale,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
    tags: ["CRM", "Documents", "Timeline"],
    prompt:
      "Build a legal case management tool with a case list, individual case detail pages showing timeline of events, document upload area, client contact information, notes section, and status tracking.",
  },
  {
    id: "crm",
    name: "CRM Tool",
    description:
      "Contact management with deal tracking, pipeline view, and activity log.",
    icon: Users,
    color: "text-green-400",
    bgColor: "bg-green-400/10",
    tags: ["Contacts", "Pipeline", "Activity"],
    prompt:
      "Build a CRM with a contact list with search and filters, a deal pipeline view with drag-and-drop kanban columns, contact detail pages with activity log, and a dashboard showing deal analytics.",
  },
  {
    id: "booking-app",
    name: "Booking App",
    description:
      "Appointment scheduling with calendar view, availability, and confirmations.",
    icon: Calendar,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    tags: ["Calendar", "Scheduling", "Notifications"],
    prompt:
      "Build a booking application with a calendar view showing available slots, a booking form with date/time picker, confirmation page, booking management dashboard, and service selection.",
  },
  {
    id: "ecommerce",
    name: "E-Commerce Store",
    description:
      "Product catalog with cart, checkout, and order management.",
    icon: ShoppingCart,
    color: "text-pink-400",
    bgColor: "bg-pink-400/10",
    tags: ["Products", "Cart", "Checkout"],
    prompt:
      "Build an e-commerce store with a product grid with search and category filters, product detail pages with image gallery, shopping cart with quantity controls, checkout form, and order confirmation page.",
  },
  {
    id: "ai-chatbot",
    name: "AI Chatbot",
    description:
      "Chat interface with conversation history, model selection, and prompt templates.",
    icon: Bot,
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    tags: ["Chat", "AI", "Templates"],
    prompt:
      "Build an AI chatbot interface with a message thread, text input with send button, conversation history sidebar, model selector dropdown, prompt template gallery, and typing animation for responses.",
  },
  {
    id: "internal-dashboard",
    name: "Internal Dashboard",
    description:
      "Team metrics, task tracking, and status boards for operations.",
    icon: Building2,
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    tags: ["Metrics", "Tasks", "Status"],
    prompt:
      "Build an internal ops dashboard with KPI cards showing team metrics, a task list with status badges and assignees, a status board with color-coded categories, and a team activity feed.",
  },
  {
    id: "mobile-landing",
    name: "Mobile Landing Page",
    description:
      "App download page with features, screenshots, and testimonials.",
    icon: Smartphone,
    color: "text-teal-400",
    bgColor: "bg-teal-400/10",
    tags: ["Mobile", "Landing", "Marketing"],
    prompt:
      "Build a mobile app landing page with a hero section showing the app on a phone mockup, feature highlights with icons, screenshot carousel, testimonial quotes, pricing section, and app store download buttons.",
  },
];

interface TemplateGalleryProps {
  onSelect: (template: Template) => void;
  selected?: string | null;
}

export function TemplateGallery({ onSelect, selected }: TemplateGalleryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {TEMPLATES.map((template, i) => (
        <motion.button
          key={template.id}
          type="button"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.04 }}
          onClick={() => onSelect(template)}
          className={`text-left rounded-xl border p-4 transition-all hover:-translate-y-0.5 active:scale-[0.98] ${
            selected === template.id
              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
              : "border-border/40 bg-card/40 hover:border-primary/20"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-lg ${template.bgColor} flex items-center justify-center shrink-0 ring-1 ring-inset ring-white/5`}
            >
              <template.icon className={`h-4.5 w-4.5 ${template.color}`} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold mb-0.5 truncate">
                {template.name}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {template.description}
              </p>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {template.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-[9px] rounded bg-muted/50 text-muted-foreground font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
