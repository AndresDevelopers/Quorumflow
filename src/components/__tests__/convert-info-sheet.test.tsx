import { Timestamp } from 'firebase/firestore';
import { ConvertInfoSheet, type ConvertWithInfo } from '@/app/(main)/converts/convert-info-sheet';
import { renderWithProviders, screen } from '@/test-support/render';

describe('ConvertInfoSheet', () => {
  it('renders convert name and recommendation toggle when open', () => {
    const convert: ConvertWithInfo = {
      id: 'convert_1',
      name: 'Juan Perez',
      baptismDate: Timestamp.now(),
      friendship: {
        id: 'friend_1',
        convertId: 'convert_1',
        convertName: 'Juan Perez',
        friends: ['member_1'],
        assignedAt: Timestamp.now(),
      },
      recommendationActive: true,
      selfRelianceCourse: false,
    };

    renderWithProviders(
      <ConvertInfoSheet
        convert={convert}
        isOpen={true}
        onOpenChange={() => {}}
        onSave={async () => {}}
        canWrite={true}
        saving={false}
        availableMembers={[
          {
            id: 'member_1',
            firstName: 'Carlos',
            lastName: 'Lopez',
            status: 'active',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            createdBy: 'test',
          },
        ]}
      />,
    );

    expect(screen.getByText('Juan Perez')).toBeInTheDocument();
  });
});
