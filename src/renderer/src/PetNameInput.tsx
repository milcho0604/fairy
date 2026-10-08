import type { InputHTMLAttributes } from 'react';
import { clipPetName } from '../../shared/settings.ts';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'> & {
  value: string;
  onValue: (value: string) => void;
  /** 상한(PET_NAME_MAX 글자)을 넘어 뒤 글자를 뗐을 때. 조용히 잘리지 않게 화면이 알린다 */
  onLimit?: () => void;
};

/**
 * 펫 이름 칸. 저장할 때와 같은 기준(사람이 보는 글자, cleanPetName)으로 12글자에서 멈춘다.
 * HTML maxLength 는 UTF-16 단위라 이모지는 두세 칸으로 세어 저장 기준과 달랐다.
 * 한글을 조합하는 동안에는 자르지 않고 조합이 끝나면 자른다 (조합 중에 값을 바꾸면 글자가 깨진다)
 */
export function PetNameInput({ value, onValue, onLimit, onCompositionEnd, ...rest }: Props) {
  const take = (raw: string, composing: boolean) => {
    if (composing) {
      onValue(raw);
      return;
    }
    const clipped = clipPetName(raw);
    // 값을 먼저 넘기고 알린다 (화면이 값을 받을 때 안내를 지우는 경우가 있어 순서가 뒤바뀌면 안내가 바로 사라진다)
    onValue(clipped);
    if (clipped !== raw) onLimit?.();
  };
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => take(e.target.value, (e.nativeEvent as InputEvent).isComposing === true)}
      onCompositionEnd={(e) => {
        onCompositionEnd?.(e);
        take(e.currentTarget.value, false);
      }}
    />
  );
}
