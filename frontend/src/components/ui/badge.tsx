import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "bg-blood-100 text-blood-600",
        secondary: "bg-sand-200 text-sand-700",
        success: "bg-teal-100 text-teal-600",
        destructive: "bg-blood-100 text-blood-400",
        outline: "bg-sand-100 text-sand-700",
        muted: "bg-sand-200 text-sand-500",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
