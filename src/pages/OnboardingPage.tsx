import { useMutation } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  FolderTree,
  Github,
  MessageSquare,
  Rocket,
  SkipForward,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";

const STEPS = [
  { id: "welcome", title: "Welcome to CodeForge", icon: Rocket },
  { id: "github", title: "Connect GitHub", icon: Github },
  { id: "project", title: "Create Your First Project", icon: FolderTree },
  { id: "tour", title: "Quick Tour", icon: Code2 },
];

const TOUR_ITEMS = [
  {
    icon: FolderTree,
    title: "File Explorer",
    description:
      "Browse, create, and organize your project files in the tree view. Right-click for more options.",
  },
  {
    icon: Code2,
    title: "Code Editor",
    description:
      "Monaco-powered editor with syntax highlighting, auto-complete, and multi-tab support. Press Ctrl+S to save.",
  },
  {
    icon: MessageSquare,
    title: "AI Chat Panel",
    description:
      "Ask questions, get suggestions, and let AI write code for you. Switch models per message.",
  },
  {
    icon: Rocket,
    title: "Deploy",
    description:
      "One-click deploy to Vercel, download as HTML, or share a live preview link.",
  },
];

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const createProject = useMutation(api.projects.create);
  const navigate = useNavigate();

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setCreating(true);
    try {
      await createProject({
        name: projectName.trim(),
        description: projectDesc.trim() || undefined,
      });
      toast.success("Project created!");
      setStep(3);
    } catch {
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = () => {
    localStorage.setItem("cf_onboarded", "true");
    toast.success("You're all set!");
    navigate("/dashboard");
  };

  const handleSkip = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  };

  const StepIcon = STEPS[step].icon;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/20 text-primary border border-primary/50"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-px",
                    i < step ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <StepIcon className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>{STEPS[step].title}</CardTitle>
            <CardDescription>
              {step === 0 &&
                "The AI-powered coding platform that helps you build faster. Let's get you started."}
              {step === 1 &&
                "Link your GitHub account to import repositories and enable Git-powered workflows."}
              {step === 2 &&
                "Every great project starts here. Give your first project a name."}
              {step === 3 &&
                "Here's a quick overview of the main panels you'll use every day."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Step 0: Welcome */}
            {step === 0 && (
              <div className="flex flex-col items-center gap-4">
                <Button size="lg" onClick={() => setStep(1)} className="w-full">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/dashboard")}
                >
                  Skip — take me to the dashboard
                </Button>
              </div>
            )}

            {/* Step 1: GitHub Connect */}
            {step === 1 && (
              <div className="space-y-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open("/settings", "_blank")}
                >
                  <Github className="mr-2 h-4 w-4" /> Connect GitHub Account
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  You can connect GitHub later from Settings
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                    <ArrowLeft className="mr-1 h-3 w-3" /> Back
                  </Button>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={handleSkip}>
                    Skip <SkipForward className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Create Project */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name</Label>
                  <Input
                    id="name"
                    placeholder="my-awesome-app"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreateProject()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description (optional)</Label>
                  <Textarea
                    id="desc"
                    placeholder="A brief description of your project"
                    value={projectDesc}
                    onChange={e => setProjectDesc(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!projectName.trim() || creating}
                  onClick={handleCreateProject}
                >
                  {creating ? "Creating..." : "Create Project"}
                  {!creating && <Rocket className="ml-2 h-4 w-4" />}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-1 h-3 w-3" /> Back
                  </Button>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={handleSkip}>
                    Skip <SkipForward className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Tour */}
            {step === 3 && (
              <div className="space-y-3">
                {TOUR_ITEMS.map(item => (
                  <div
                    key={item.title}
                    className="flex gap-3 p-3 rounded-lg bg-muted/50"
                  >
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium">{item.title}</h4>
                      <p className="text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
                <Button className="w-full" onClick={handleFinish}>
                  Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                    <ArrowLeft className="mr-1 h-3 w-3" /> Back
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
