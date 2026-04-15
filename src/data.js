export const defaultProject = {
  meta: {
    title: 'Thesis System Map',
    subtitle: 'Research / presentation workspace'
  },
  presentation: { steps: [] },
  clusters: [
    { id: 'cluster-law', name: 'Recht', color: '#4d8fff', position: { x: -6, y: 4, z: 2 }, radius: 2.4 },
    { id: 'cluster-tech', name: 'Technologie', color: '#cc55ff', position: { x: 6, y: 4, z: 1 }, radius: 2.4 },
    { id: 'cluster-pharma', name: 'Pharma', color: '#ff5566', position: { x: -6, y: -3, z: -1 }, radius: 2.4 },
    { id: 'cluster-economy', name: 'Wirtschaft', color: '#ffbb00', position: { x: 6, y: -3, z: 0 }, radius: 2.4 },
    { id: 'cluster-state', name: 'Staat', color: '#22ccee', position: { x: 0, y: 6, z: -4 }, radius: 2.4 },
    { id: 'cluster-body', name: 'Körper', color: '#44dd88', position: { x: 0, y: -6, z: 4 }, radius: 2.4 }
  ],
  nodes: [
    { id: 'law-1', clusterId: 'cluster-law', label: 'Recht 1', position: { x: -6.8, y: 4.4, z: 2.1 }, note: '' },
    { id: 'law-2', clusterId: 'cluster-law', label: 'Recht 2', position: { x: -5.3, y: 4.5, z: 1.7 }, note: '' },
    { id: 'tech-1', clusterId: 'cluster-tech', label: 'Technologie 1', position: { x: 5.4, y: 4.3, z: 1.1 }, note: '' },
    { id: 'tech-2', clusterId: 'cluster-tech', label: 'Technologie 2', position: { x: 6.7, y: 3.6, z: 1.5 }, note: '' },
    { id: 'pharma-1', clusterId: 'cluster-pharma', label: 'Pharma 1', position: { x: -6.7, y: -2.8, z: -0.5 }, note: '' },
    { id: 'economy-1', clusterId: 'cluster-economy', label: 'Wirtschaft 1', position: { x: 5.7, y: -2.9, z: -0.3 }, note: '' },
    { id: 'state-1', clusterId: 'cluster-state', label: 'Staat 1', position: { x: 0.7, y: 6.1, z: -4.4 }, note: '' },
    { id: 'body-1', clusterId: 'cluster-body', label: 'Körper 1', position: { x: -0.8, y: -5.8, z: 4.3 }, note: '' }
  ],
  links: [
    { id: 'link-1', source: 'law-1', target: 'state-1', label: 'governance relation' },
    { id: 'link-2', source: 'law-2', target: 'tech-1', label: 'regulatory interface' },
    { id: 'link-3', source: 'tech-2', target: 'pharma-1', label: 'applied innovation' },
    { id: 'link-4', source: 'economy-1', target: 'state-1', label: 'policy economy' },
    { id: 'link-5', source: 'state-1', target: 'body-1', label: 'public health axis' }
  ]
}
