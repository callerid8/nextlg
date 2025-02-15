// components/ThemeToggle.tsx
"use client";

import { useTheme } from 'next-themes';
import { Button } from './ui/button';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
    const { theme, setTheme } = useTheme();

    return (
        <Button variant="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Moon className="inline dark:hidden" />
            <Sun className="hidden dark:inline" />
        </Button>
    );
}