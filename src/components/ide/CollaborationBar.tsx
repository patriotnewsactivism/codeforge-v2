import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Users, Copy, Check, Link2 } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

interface CollaborationBarProps {
  projectId: Id<"projects">;
  projectName: string;
}

export function CollaborationBar({
  projectId,
  projectName,
}: CollaborationBarProps) {
  const collaborators = useQuery(api.collaboration.listActive, { projectId });
  const createInvite = useMutation(api.collaboration.createInvite);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreateInvite = async () => {
    const code = await createInvite({ projectId });
    setInviteCode(code);
  };

  const handleCopyInvite = () => {
    if (inviteCode) {
      const url = `${window.location.origin}/join/${inviteCode}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-[oklch(0.09_0.02_260)] border-b border-border">
      {/* Project name */}
      <div className="flex items-center gap-2">
        <span className="text-primary font-bold text-sm">{"</>"}</span>
        <span className="text-sm font-medium text-foreground">
          {projectName}
        </span>
      </div>

      <div className="flex-1" />

      {/* Active collaborators */}
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex items-center -space-x-1.5">
          {collaborators?.map((collab) => (
            <div
              key={collab._id}
              className="w-6 h-6 rounded-full border-2 border-[oklch(0.09_0.02_260)] flex items-center justify-center text-[10px] font-bold"
              style={{ backgroundColor: collab.color }}
              title={`${collab.userName}${collab.activeFile ? ` — ${collab.activeFile}` : ""}`}
            >
              {collab.userName.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {collaborators?.length ?? 0} online
        </span>
      </div>

      {/* Invite button */}
      <div className="flex items-center gap-1">
        {inviteCode ? (
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors"
            onClick={handleCopyInvite}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied!" : "Copy Link"}
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-[oklch(0.18_0.02_260)] text-muted-foreground rounded hover:bg-[oklch(0.22_0.02_260)] hover:text-foreground transition-colors"
            onClick={handleCreateInvite}
          >
            <Link2 className="h-3 w-3" />
            Invite
          </button>
        )}
      </div>
    </div>
  );
}
