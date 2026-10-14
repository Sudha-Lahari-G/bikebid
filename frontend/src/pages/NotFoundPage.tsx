import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="h-8 w-8" />}
      title="Wrong turn"
      action={
        <Link to="/" className="btn-primary">
          Back to auctions
        </Link>
      }
    >
      The page you're looking for doesn't exist.
    </EmptyState>
  );
}
