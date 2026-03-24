import logoSrc from '../../img/logo-turnos-psico-blanco.svg';

interface Props {
  className?: string;
}

export function Logo({ className }: Props) {
  return <img src={logoSrc} alt="Turnos Psico" className={className} />;
}
