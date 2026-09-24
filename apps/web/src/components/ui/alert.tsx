import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      info: 'border-primary/30 bg-primary/10 text-foreground',
      success: 'border-success/30 bg-success/10 text-foreground',
      warning: 'border-warning/40 bg-warning/10 text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h4 className={cn('mb-1 font-medium leading-none', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
