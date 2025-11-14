import { FormInput } from '@components/formik';
import { Button, LinkComponent, Loader, Typography } from '@components/UI';
import Logo from '@components/UI/Decorators/Event-Rulers/Logo';

import { useLoginUserMutation } from '@features/auth/api/auth.api';
import { useLandscape, useMobile } from '@hooks/index';
import { useAppDispatch } from '@store/hooks';

import { GlobalStateActions } from '@store/slices/globalStateReducer';
import { Formik, Form } from 'formik';
import React from 'react';

import { useNavigate } from 'react-router-dom';

import * as Yup from 'yup';

import { ISnackbar } from './auth.types';
import { setCredentials } from './authSlice';
import classes from './style.module.scss';

const initialValues = {
  user_email: '',
  user_password: '',
};

export const Login = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const validationSchema = Yup.object({
    user_email: Yup.string()
      .email('Nieprawidłowy email')
      .required('Email jest wymagany'),
    user_password: Yup.string()
      .min(6, 'Minimum 6 znaków')
      .required('Hasło jest wymagane'),
  });

  const isMobile = useMobile();
  const isLandscape = useLandscape();

  const [loginUser, { isLoading, error }] = useLoginUserMutation();

  const onSubmit = async (values: typeof initialValues) => {
    try {
      const data = await loginUser(values).unwrap();
      dispatch(setCredentials(data));
      navigate(-1);
      dispatch(GlobalStateActions.drawerFunc(false));
    } catch (err: any) {
      alert(err?.data?.message || 'Błąd logowania');
    }
  };

  return (
    <article className={classes.login}>
      <div className={classes.background} />
      <div className={classes['login-wrapper']}>
        <div className={classes['login__logo']}>
          <Logo
            onClick={() => {
              return navigate('/');
            }}
            duration={0.5}
            delay={0.2}
            height={isMobile ? (isLandscape ? 80 : 160) : 300}
            width={300}
            color="--main-gold"
            aria-label="logo"
          />
        </div>
        <div className={classes['login-content']}>
          <Formik
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={onSubmit}
          >
            <Form>
              <div>
                <FormInput
                  variant="filled"
                  type="email"
                  name="user_email"
                  label="Email"
                />
              </div>
              <div>
                <FormInput
                  variant="filled"
                  type="password"
                  name="user_password"
                  label="Hasło"
                />
              </div>
              {(error as { snackbar?: ISnackbar })?.snackbar?.message}
              <div className={classes.actions}>
                {isLoading ? (
                  <Loader fullWidth />
                ) : (
                  <>
                    <Button
                      variant="outlined"
                      size="x-small"
                      type="submit"
                      color="--border-submit"
                    >
                      Zaloguj
                    </Button>
                    <Typography size="xx-small" fontFamily="barlow-italic">
                      Nie masz jeszcze konta?{' '}
                      <LinkComponent
                        to="/admin/auth/signup"
                        color="--border-submit"
                        fontFamily="barlow-italic-bold"
                        label="przejdź do rarejetruj się!"
                      >
                        Załóż je!
                      </LinkComponent>
                    </Typography>
                  </>
                )}
              </div>
            </Form>
          </Formik>
        </div>
      </div>
    </article>
  );
};

export default Login;
