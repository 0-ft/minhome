import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "bg-blood-600/50 text-blood-100",
        secondary: "bg-blood-500/40 text-blood-200",
        success: "bg-teal-400/20 text-teal-200",
        destructive: "bg-blood-700/50 text-blood-100",
        outline: "bg-blood-500/30 text-blood-200",
        muted: "bg-blood-600/40 text-blood-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
