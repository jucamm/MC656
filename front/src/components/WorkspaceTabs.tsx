import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { GroupsDashboard } from './groups/GroupsDashboard';
import { CompendiumPanel } from './legislative-compendia/CompendiumPanel';
import { MeetingsDashboard } from './meetings/MeetingsDashboard';

const sections = [
  { id: 'meetings', label: 'Reuniões' },
  { id: 'groups', label: 'Grupos' },
  { id: 'bills', label: 'Projetos de lei' },
] as const;

type Section = typeof sections[number]['id'];

export function WorkspaceTabs({ userId, userName, initialMeetingId }: {
  userId: string; userName: string; initialMeetingId: string | null;
}) {
  const id = useId();
  const [current, setCurrent] = useState<Section>('meetings');
  const [visited, setVisited] = useState<ReadonlySet<Section>>(() => new Set(['meetings']));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = {
    meetings: <MeetingsDashboard userId={userId} userName={userName} initialMeetingId={initialMeetingId} />,
    groups: <GroupsDashboard userId={userId} />,
    bills: <section aria-labelledby={id + '-summaries'} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id={id + '-summaries'} className="mb-4 text-2xl font-bold">Resumos de PLs</h2>
      <CompendiumPanel />
    </section>,
  };

  function activate(section: Section) {
    setCurrent(section);
    setVisited(previous => previous.has(section) ? previous : new Set([...previous, section]));
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % sections.length; break;
      case 'ArrowLeft': next = (index + sections.length - 1) % sections.length; break;
      case 'Home': next = 0; break;
      case 'End': next = sections.length - 1; break;
      default: return;
    }
    event.preventDefault();
    tabs.current[next]?.focus();
    activate(sections[next].id);
  }

  return <div className="mx-auto max-w-6xl space-y-4">
    <div role="tablist" aria-label="Áreas do Unidebates" className="flex flex-wrap gap-2">
      {sections.map((section, index) => (
        <button key={section.id} ref={element => { tabs.current[index] = element; }}
          id={id + '-tab-' + section.id} type="button" role="tab"
          aria-controls={id + '-panel-' + section.id} aria-selected={section.id === current}
          tabIndex={section.id === current ? 0 : -1} onClick={() => activate(section.id)}
          onKeyDown={event => moveFocus(event, index)} className="ui-button workspace-tab">
          {section.label}
        </button>
      ))}
    </div>
    {sections.map(section => (
      <div key={section.id} id={id + '-panel-' + section.id} role="tabpanel"
        aria-labelledby={id + '-tab-' + section.id} hidden={section.id !== current} tabIndex={0}>
        {visited.has(section.id) && panels[section.id]}
      </div>
    ))}
  </div>;
}
