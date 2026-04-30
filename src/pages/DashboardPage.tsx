import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  FolderOpen,
  Trash2,
  Clock,
  Code2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export function DashboardPage() {
  const projects = useQuery(api.projects.list) ?? [];
  const createProject = useMutation(api.projects.create);
  const removeProject = useMutation(api.projects.remove);
  const navigate = useNavigate();

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      const projectId = await createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
      });
      toast.success(`Created ${newProjectName}`);
      setDialogOpen(false);
      setNewProjectName("");
      setNewProjectDesc("");
      navigate(`/project/${projectId}`);
    } catch {
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (projectId: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await removeProject({ projectId: projectId as any });
      toast.success(`Deleted ${name}`);
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const sortedProjects = [...projects].sort(
    (a, b) => b.lastOpenedAt - a.lastOpenedAt
  );

  return (
    <div className="min-h-[calc(100vh-64px)] p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Code2 className="h-7 w-7 text-primary" />
              Your Projects
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Create, manage, and code with AI assistance
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>
                  Start a new project with HTML, CSS, and JavaScript files.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name</Label>
                  <Input
                    id="name"
                    placeholder="my-awesome-project"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description (optional)</Label>
                  <Input
                    id="desc"
                    placeholder="A brief description of your project"
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={!newProjectName.trim() || creating}
                >
                  {creating ? "Creating..." : "Create Project"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Projects grid */}
        {sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Create your first project to start coding with AI
            </p>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create First Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedProjects.map((project) => (
              <Card
                key={project._id}
                className="group cursor-pointer hover:border-primary/50 transition-colors bg-card"
                onClick={() => navigate(`/project/${project._id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">
                        {project.name}
                      </CardTitle>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(project._id, project.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                  {project.description && (
                    <CardDescription className="text-xs line-clamp-2">
                      {project.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeAgo(project.lastOpenedAt)}
                    </div>
                    {project.language && (
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                        {project.language}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
