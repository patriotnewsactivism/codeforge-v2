import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  FolderTree,
  Github,
  Loader2,
  MessageSquare,
  Rocket,
  SkipForward,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  TemplateGallery,
  type Template,
} from "@/components/TemplateGallery";
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
  { id: "choose", title: "What will you build?", icon: Wand2 },
  { id: "setup", title: "Set up your project", icon: FolderTree },
  { id: "tour", title: "You're ready!", icon: Code2 },
];

const TOUR_ITEMS = [
  {
    icon: FolderTree,
    title: "File Explorer",
    description:
      "Browse, create, and organize your project files. Right-click for more options.",
  },
  {
    icon: Code2,
    title: "Code Editor",
    description:
      "Monaco-powered editor with syntax highlighting and Ctrl+S to save.",
  },
  {
    icon: MessageSquare,
    title: "AI Chat Panel",
    description:
      "Ask questions, get suggestions, and let AI write code for you.",
  },
  {
    icon: Rocket,
    title: "Deploy",
    description:
      "One-click deploy to Vercel, download as HTML, or share a live preview link.",
  },
];

type BuildMode = "template" | "prompt" | null;

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [buildMode, setBuildMode] = useState<BuildMode>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const createProject = useMutation(api.projects.create);
  const finishOnboarding = useMutation(api.users.completeOnboarding);
  const navigate = useNavigate();

  const handleCreateProject = async () => {
    const name =
      projectName.trim() ||
      selectedTemplate?.name ||
      `project-${Date.now().toString(36)}`;
    setCreating(true);
    try {
      const projectId = await createProject({
        name,
        description:
          buildMode === "template"
            ? selectedTemplate?.description
            : customPrompt.trim() || undefined,
      });
      toast.success("Project created!");
      // Complete onboarding
      localStorage.setItem("cf_onboarded", "true");
      try {
        await finishOnboarding();
      } catch {
        // Non-blocking
      }
      navigate(`/project/${projectId}`);
    } catch {
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = async () => {
    localStorage.setItem("cf_onboarded", "true");
    try {
      await finishOnboarding();
      toast.success("You're all set!");
      navigate("/dashboard");
    } catch {
      toast.error("Failed to save progress, but you can proceed");
      navigate("/dashboard");
    }
  };

  const handleSkip = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  };

  const canProceedFromChoose =
    (buildMode === "template" && selectedTemplate) ||
    (buildMode === "prompt" && customPrompt.trim().length > 10);

  const StepIcon = STEPS[step]!.icon;

  const slideVariants = {
    enter: { opacity: 0, x: 20 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-xl relative z-10">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <motion.div
                initial={false}
                animate={{
                  scale: i === step ? 1.1 : 1,
                  backgroundColor:
                    i < step
                      ? "oklch(0.75 0.18 190)"
                      : i === step
                        ? "oklch(0.75 0.18 190 / 0.2)"
                        : "oklch(0.20 0.02 260)",
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  i < step
                    ? "text-primary-foreground"
                    : i === step
                      ? "text-primary border border-primary/50"
                      : "text-muted-foreground",
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </motion.div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-px transition-colors",
                    i < step ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <Card className="border-border/40 bg-card/60 backdrop-blur-sm">
          <CardHeader className="text-center">
            <motion.div
              key={step}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mx-auto mb-3 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20"
            >
              <StepIcon className="h-6 w-6 text-primary" />
            </motion.div>
            <CardTitle>{STEPS[step]!.title}</CardTitle>
            <CardDescription>
              {step === 0 &&
                "The AI-powered platform that builds software autonomously. Let's get you started."}
              {step === 1 &&
                "Pick a template to start fast, or describe what you want to build."}
              {step === 2 && "Name your project and we'll create it for you."}
              {step === 3 &&
                "Here's a quick overview of the tools at your disposal."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25 }}
              >
                {/* Step 0: Welcome */}
                {step === 0 && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-2">
                      {[
                        { label: "10 Templates", icon: "🎨" },
                        { label: "AI Agents", icon: "🤖" },
                        { label: "Live Preview", icon: "👁️" },
                      ].map(item => (
                        <div
                          key={item.label}
                          className="text-center p-3 rounded-lg bg-muted/30 border border-border/30"
                        >
                          <div className="text-lg mb-1">{item.icon}</div>
                          <div className="text-[10px] text-muted-foreground font-medium">
                            {item.label}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="lg"
                      onClick={() => setStep(1)}
                      className="w-full gap-2 shadow-lg shadow-primary/20"
                    >
                      Get Started
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFinish}
                      className="text-muted-foreground"
                    >
                      Skip — take me to the dashboard
                    </Button>
                  </div>
                )}

                {/* Step 1: Choose what to build */}
                {step === 1 && (
                  <div className="space-y-4">
                    {/* Mode selector */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setBuildMode("template")}
                        className={cn(
                          "p-3 rounded-lg border text-center transition-all text-sm font-medium",
                          buildMode === "template"
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border/40 text-muted-foreground hover:border-primary/20",
                        )}
                      >
                        🎨 Pick a Template
                      </button>
                      <button
                        type="button"
                        onClick={() => setBuildMode("prompt")}
                        className={cn(
                          "p-3 rounded-lg border text-center transition-all text-sm font-medium",
                          buildMode === "prompt"
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border/40 text-muted-foreground hover:border-primary/20",
                        )}
                      >
                        ✍️ Describe Your App
                      </button>
                    </div>

                    {buildMode === "template" && (
                      <div className="max-h-[340px] overflow-y-auto pr-1 -mr-1">
                        <TemplateGallery
                          onSelect={t => setSelectedTemplate(t)}
                          selected={selectedTemplate?.id}
                        />
                      </div>
                    )}

                    {buildMode === "prompt" && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <Sparkles className="h-3 w-3 text-primary" />
                          Describe what you want to build
                        </div>
                        <Textarea
                          placeholder="Build me a membership site for civil rights reporting with paid subscriptions, articles, videos, comments, admin publishing, and email capture..."
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          rows={5}
                          className="resize-none"
                        />
                        <p className="text-[10px] text-muted-foreground/60">
                          Be specific about features, pages, and functionality
                          you want.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep(0)}
                      >
                        <ArrowLeft className="mr-1 h-3 w-3" /> Back
                      </Button>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSkip}
                        className="text-muted-foreground"
                      >
                        Skip <SkipForward className="ml-1 h-3 w-3" />
                      </Button>
                      {canProceedFromChoose && (
                        <Button size="sm" onClick={() => setStep(2)}>
                          Next <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 2: Name & create */}
                {step === 2 && (
                  <div className="space-y-4">
                    {selectedTemplate && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                        <selectedTemplate.icon
                          className={`h-4 w-4 ${selectedTemplate.color}`}
                        />
                        <span className="font-medium">
                          {selectedTemplate.name}
                        </span>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="name">Project Name</Label>
                      <Input
                        id="name"
                        placeholder={
                          selectedTemplate?.name.toLowerCase().replace(/ /g, "-") ||
                          "my-awesome-app"
                        }
                        value={projectName}
                        onChange={e => setProjectName(e.target.value)}
                        onKeyDown={e =>
                          e.key === "Enter" && handleCreateProject()
                        }
                        autoFocus
                      />
                    </div>
                    <Button
                      className="w-full gap-2 shadow-lg shadow-primary/20"
                      disabled={creating}
                      onClick={handleCreateProject}
                    >
                      {creating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Rocket className="h-4 w-4" />
                          Create & Open Project
                        </>
                      )}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep(1)}
                      >
                        <ArrowLeft className="mr-1 h-3 w-3" /> Back
                      </Button>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSkip}
                        className="text-muted-foreground"
                      >
                        Skip <SkipForward className="ml-1 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 3: Tour */}
                {step === 3 && (
                  <div className="space-y-3">
                    {TOUR_ITEMS.map((item, i) => (
                      <motion.div
                        key={item.title}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border/30"
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
                      </motion.div>
                    ))}
                    <Button
                      className="w-full gap-2 shadow-lg shadow-primary/20"
                      onClick={handleFinish}
                    >
                      Go to Dashboard
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep(2)}
                      >
                        <ArrowLeft className="mr-1 h-3 w-3" /> Back
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
