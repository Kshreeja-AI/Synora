import { redirect } from 'next/navigation';

export default function SettingsIndexPage(): React.JSX.Element {
  redirect('/dashboard/settings/profile');
}
