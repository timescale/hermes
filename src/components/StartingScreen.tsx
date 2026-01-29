import { Loading } from './Loading';

export interface StartingScreenProps {
  step: string;
}

export const StartingScreen = ({ step }: StartingScreenProps) => (
  <Loading message="Loading" detail={step} />
);
